# Serve solo per l'API locale Xiaomi (non usata con Dreamehome).
class MiIOProtocol:
    def __init__(self, *a, **k):
        raise RuntimeError("python-miio non installato")
