# Ponte tra HomeMate (Node) e il cloud Dreamehome, per il robot Dreame.
# Usa il protocollo cloud del progetto open source Tasshack/dreame-vacuum (licenza MIT), scaricato sul tablet
# dall'installazione in ~/dreame-vacuum: Dreame cambia spesso il suo cloud e quel progetto lo segue.
# Parla con Node una riga JSON alla volta: {"id":1,"cmd":"status"} -> {"id":1,"ok":true,"data":{...}}
import importlib.util
import json
import logging
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.environ.get("DREAME_LIB") or os.path.expanduser("~/dreame-vacuum/custom_components/dreame_vacuum/dreame")
logging.basicConfig(stream=sys.stderr, level=logging.WARNING, format="dreame: %(message)s")

# proprietà e azioni MIoT del robot (le stesse dell'app)
PROPS = {"stato": (2, 1), "errore": (2, 2), "batteria": (3, 1), "carica": (3, 2), "tempo": (4, 2), "area": (4, 3)}
ACTIONS = {"avvia": (2, 1), "pausa": (2, 2), "base": (3, 1)}


def load_protocol():
    if os.environ.get("DREAME_FAKE"):
        return FakeProtocol
    sys.path.append(os.path.join(HERE, "dreame_shim"))  # solo per i moduli che mancano davvero
    if not os.path.isfile(os.path.join(LIB, "protocol.py")):
        raise RuntimeError("libreria Dreame non trovata in " + LIB + ": rilancia l'installazione")
    pkg = types.ModuleType("dreamelib")
    pkg.__path__ = [LIB]  # pacchetto senza __init__: non carica mappe e Home Assistant
    sys.modules["dreamelib"] = pkg
    spec = importlib.util.spec_from_file_location("dreamelib.protocol", os.path.join(LIB, "protocol.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules["dreamelib.protocol"] = mod
    spec.loader.exec_module(mod)
    return mod.DreameVacuumDreameHomeCloudProtocol


class FakeProtocol:
    """Robot finto per le prove (DREAME_FAKE=1)."""
    state = {"stato": 6, "errore": 0, "batteria": 87, "carica": 1, "tempo": 0, "area": 0}

    def __init__(self, username, password, account_type="dreame", country="eu", auth_key=None, did=None):
        self._username, self._password, self._secondary_key, self._did = username, password, auth_key, did

    def login(self):
        if self._secondary_key == "scaduto" or (not self._secondary_key and self._password != "giusta"):
            return False
        self._secondary_key = "r-" + str(len(self._username))
        return True

    def get_devices(self):
        return {"page": {"records": [
            {"did": "111", "model": "dreame.vacuum.r2338a", "customName": "", "deviceInfo": {"displayName": "L10s Pro Ultra Heat"}},
            {"did": "222", "model": "dreame.hold.w2422", "customName": "Lavapavimenti", "deviceInfo": {"displayName": "H12"}},
        ]}}

    def get_device_info(self):
        return {"did": self._did}

    def send(self, method, params, retry_count=2, timeout=None):
        s = FakeProtocol.state
        if method == "get_properties":
            names = {v: k for k, v in PROPS.items()}
            return [{"siid": p["siid"], "piid": p["piid"], "code": 0, "value": s[names[(p["siid"], p["piid"])]]} for p in params]
        if method == "action":
            a = (params["siid"], params["aiid"])
            s["stato"] = {(2, 1): 1, (2, 2): 3, (3, 1): 5}[a]
            s["carica"] = 2
            return {"code": 0}


Protocol = None


class Robot:
    def __init__(self):
        self.p = None

    def refresh(self):
        return getattr(self.p, "_secondary_key", None)

    def login(self, username, password, country):
        p = Protocol(username, password, "dreame", country or "eu")
        if not p.login():
            raise RuntimeError("Accesso a Dreamehome non riuscito: controlla email, password e regione")
        self.p = p
        devs = p.get_devices()
        if devs is None:
            raise RuntimeError("Accesso riuscito, ma Dreamehome non ha dato l'elenco dei dispositivi")
        robots = []
        for d in devs.get("page", {}).get("records", []):
            if ".vacuum." in str(d.get("model")):
                robots.append({"did": str(d["did"]), "model": d["model"],
                               "nome": d.get("customName") or (d.get("deviceInfo") or {}).get("displayName") or d["model"]})
        return {"robot": robots}

    def use(self, username, country, refresh, did):
        p = Protocol(username, None, "dreame", country or "eu", auth_key=refresh, did=did)
        if not p.login():
            raise RuntimeError("SCOLLEGATO: accesso a Dreamehome scaduto, ricollega il robot")
        if p.get_device_info() is None:
            raise RuntimeError("Robot non trovato nell'account Dreamehome")
        self.p = p
        return {}

    def need(self):
        if self.p is None:
            raise RuntimeError("robot non collegato")

    def status(self):
        self.need()
        did = str(self.p._did)
        res = self.p.send("get_properties", [{"did": did, "siid": s, "piid": p} for s, p in PROPS.values()])
        if res is None:
            raise RuntimeError("il robot non risponde")
        by = {(r.get("siid"), r.get("piid")): r.get("value") for r in res if r.get("code", 0) == 0}
        return {k: by.get(v) for k, v in PROPS.items()}

    def action(self, nome):
        self.need()
        if nome not in ACTIONS:
            raise RuntimeError("comando sconosciuto")
        s, a = ACTIONS[nome]
        res = self.p.send("action", {"did": str(self.p._did), "siid": s, "aiid": a, "in": []})
        if res is None:
            raise RuntimeError("il robot non ha ricevuto il comando")
        return {}


def main():
    global Protocol
    robot = Robot()
    try:
        Protocol = load_protocol()
        print(json.dumps({"id": 0, "ok": True, "data": {"pronto": True}}), flush=True)
    except Exception as e:
        print(json.dumps({"id": 0, "ok": False, "error": "Componente Dreame non installato: " + str(e)}), flush=True)
        return
    for line in sys.stdin:
        try:
            req = json.loads(line)
        except ValueError:
            continue
        rid = req.get("id")
        try:
            cmd = req.get("cmd")
            if cmd == "login":
                data = robot.login(req.get("username", ""), req.get("password", ""), req.get("country"))
            elif cmd == "use":
                data = robot.use(req.get("username", ""), req.get("country"), req.get("refresh"), req.get("did"))
            elif cmd == "status":
                data = robot.status()
            elif cmd == "action":
                data = robot.action(req.get("nome"))
            else:
                raise RuntimeError("comando sconosciuto")
            out = {"id": rid, "ok": True, "data": data, "refresh": robot.refresh()}
        except Exception as e:
            out = {"id": rid, "ok": False, "error": str(e), "refresh": robot.refresh()}
        print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
