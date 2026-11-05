# AES (ECB) e ARC4 sopra "cryptography", con la stessa interfaccia di pycryptodome usata dal protocollo
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


class _Enc:
    def __init__(self, c):
        self._c = c

    def encrypt(self, data):
        e = self._c.encryptor()
        return e.update(data) + e.finalize()

    def decrypt(self, data):
        d = self._c.decryptor()
        return d.update(data) + d.finalize()


class AES:
    MODE_ECB = 1

    @staticmethod
    def new(key, mode):
        if mode != AES.MODE_ECB:
            raise ValueError("solo ECB")
        return _Enc(Cipher(algorithms.AES(key), modes.ECB()))


class ARC4:
    @staticmethod
    def new(key):
        try:
            from cryptography.hazmat.decrepit.ciphers.algorithms import ARC4 as _A
        except ImportError:
            _A = algorithms.ARC4
        return _Enc(Cipher(_A(key), mode=None))
