# Usato dal protocollo solo per il canale MQTT con CA privata, che HomeMate non usa.
class _Missing:
    def __init__(self, *a, **k):
        raise RuntimeError("pyOpenSSL non installato")

    @classmethod
    def from_cryptography(cls, *a, **k):
        raise RuntimeError("pyOpenSSL non installato")


X509 = X509Store = X509StoreContext = _Missing
