def pad(data, block_size, style="pkcs7"):
    n = block_size - len(data) % block_size
    return data + bytes([n]) * n


def unpad(data, block_size, style="pkcs7"):
    return data[: -data[-1]]
