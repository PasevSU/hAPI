#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Независима проверка на AEAD-защитата на секретен ключ (RFC 9580 §5.5.3, usage 253).

ЗАЩО СЪЩЕСТВУВА
`hapi_enterprise/pgp.js` отваря такива ключове чрез нативния OCB на OpenSSL, но досега
единственият „втори“ прочит беше собственият му фикстур: същият код заключва и отваря.
GnuPG 2.5.24 отговаря „S2K pseudo algo 253 is not yet supported“, тоест на тази машина
нямаше независим еталон и подредбата на полетата се проверяваше само с „тагът мина“.

Този скрипт е ТОЗИ еталон, но на друг език и друга библиотека (`cryptography`, AESOCB3 /
AESGCM). Той не внася нищо от `pgp.js`: S2K извеждането, свързаните данни (`0xC5 || публична
част`), nonce и подредбата са написани наново по RFC. Затова:

  • ако `pgp.js` сгреши подредбата, nonce-то или AD — този скрипт не може да декриптира;
  • ако скриптът сгреши — `pgp.js` не може да отвори неговия ключ.

Ползва се от `tests/pgp-aead-interop.cjs`. Иска се `cryptography`; липсата ѝ НЕ е повод за
„мина“ — тестът се пропуска с изрично съобщение.

    python tests/lib/aead-interop.py <команда> <json-файл>
    команди: decrypt | encrypt
"""
import base64
import hashlib
import json
import os
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM, AESOCB3

TAG = 16
# Номерацията е на OpenPGP, не на библиотеката: 1 = EAX, 2 = OCB, 3 = GCM.
AEAD = {2: AESOCB3, 3: AESGCM}
# Само тези, които `cryptography` покрива; CAST5/BLOWFISH/IDEA липсват и в Node.
CIPHERS = {7: 16, 8: 24, 9: 32}
HASHES = {1: 'md5', 2: 'sha1', 3: 'ripemd160', 8: 'sha256', 9: 'sha384', 10: 'sha512', 11: 'sha224'}


def s2k_derive(spec, passphrase, key_bytes):
    """RFC 4880 §3.7.1: тип 0 (прост), 1 (солен), 3 (итериран и солен) → ключ за шифъра."""
    kind = spec[0]
    name = HASHES.get(spec[1])
    if name is None:
        raise ValueError('непознат хеш за S2K: %d' % spec[1])
    salt = spec[2:10] if kind in (1, 3) else b''
    count = 0
    if kind == 3:
        coded = spec[10]
        count = (16 + (coded & 15)) << ((coded >> 4) + 6)
    source = salt + passphrase if kind else passphrase
    if not source:
        raise ValueError('празна парола')
    total = count if kind == 3 else len(source)
    data = (source * (total // len(source) + 1))[:total]
    out = b''
    index = 0
    while len(out) < key_bytes:
        # Всеки следващ хеш се предшества от (i−1) нулеви октета (RFC 4880 §3.7.1.1).
        digest = hashlib.new(name, b'\x00' * index + data if index else data).digest()
        out += digest
        index += 1
    return out[:key_bytes]


def parse(sealed):
    """Разчита секцията: връща (symAlgo, aeadAlgo, spec, nonce, ciphertext, tag)."""
    if sealed[0] != 253:
        raise ValueError('началото не е 253 (AEAD), а %d' % sealed[0])
    at = 1
    params_len = sealed[at]
    at += 1
    if params_len != len(sealed) - 2:
        raise ValueError('дължината на параметрите не пасва: %d срещу %d' % (params_len, len(sealed) - 2))
    sym = sealed[at]
    aead = sealed[at + 1]
    at += 2
    spec_len = sealed[at]
    at += 1
    spec = bytes(sealed[at:at + spec_len])
    at += spec_len
    nonce_len = sealed[at]
    at += 1
    nonce = bytes(sealed[at:at + nonce_len])
    at += nonce_len
    ciphertext = bytes(sealed[at:len(sealed) - TAG])
    tag = bytes(sealed[len(sealed) - TAG:])
    return sym, aead, spec, nonce, ciphertext, tag


def decrypt(payload):
    sealed = base64.b64decode(payload['sealed'])
    public_body = base64.b64decode(payload['publicBody'])
    passphrase = payload['passphrase'].encode('utf-8')
    sym, aead, spec, nonce, ciphertext, tag = parse(sealed)
    if sym not in CIPHERS:
        raise ValueError('неподдържан шифър: %d' % sym)
    if aead not in AEAD:
        raise ValueError('неподдържан AEAD режим: %d' % aead)
    key = s2k_derive(spec, passphrase, CIPHERS[sym])
    # Свързаните данни са пакетният таг на секретния ключ (0xC5) и публичната част — точно
    # това прави секцията неотделима от своя ключ.
    ad = b'\xc5' + public_body
    plain = AEAD[aead](key).decrypt(nonce, ciphertext + tag, ad)
    return {'plain': base64.b64encode(plain).decode('ascii')}


def encrypt(payload):
    plain = base64.b64decode(payload['plain'])
    public_body = base64.b64decode(payload['publicBody'])
    passphrase = payload['passphrase'].encode('utf-8')
    sym = int(payload.get('symAlgo', 9))
    aead = int(payload.get('aeadAlgo', 2))
    variant = payload.get('variant', 'with-length')
    if sym not in CIPHERS:
        raise ValueError('неподдържан шифър: %d' % sym)
    if aead not in AEAD:
        raise ValueError('неподдържан AEAD режим: %d' % aead)
    salt = os.urandom(8)
    # Тип 3 (итериран и солен), SHA-256 — същата спецификация, различен код.
    spec = bytes([3, 8]) + salt + bytes([96])
    key = s2k_derive(spec, passphrase, CIPHERS[sym])
    # Nonce дължината я дава RFC за режима, не „колкото излезе“.
    nonce_len = 15 if aead == 2 else 12
    nonce = os.urandom(nonce_len)
    ad = b'\xc5' + public_body
    blob = AEAD[aead](key).encrypt(nonce, plain, ad)
    ciphertext, tag = blob[:-TAG], blob[-TAG:]
    head = bytes([sym, aead, len(spec)]) + spec
    body = head + bytes([len(nonce)]) + nonce + ciphertext + tag
    if variant == 'with-length':
        sealed = bytes([253, len(body)]) + body
    elif variant == 'without-length':
        # Някои издания пропускат октета за обща дължина; `pgp.js` трябва да приема и двете.
        sealed = bytes([253]) + body
    else:
        raise ValueError('непознат вариант: %s' % variant)
    return {'sealed': base64.b64encode(sealed).decode('ascii')}


def main(argv):
    if len(argv) != 2:
        print(json.dumps({'error': 'употреба: aead-interop.py decrypt|encrypt <json-файл>'}))
        return 2
    command, path = argv
    with open(path, 'r', encoding='utf-8') as handle:
        payload = json.load(handle)
    try:
        if command == 'decrypt':
            print(json.dumps(decrypt(payload)))
        elif command == 'encrypt':
            print(json.dumps(encrypt(payload)))
        else:
            print(json.dumps({'error': 'непозната команда: %s' % command}))
            return 2
    except Exception as exc:                      # всяка грешка е „не мина“, не „почти“
        print(json.dumps({'error': '%s: %s' % (type(exc).__name__, exc)}))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
