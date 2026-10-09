import hashlib

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

hasher = PasswordHasher()


def hash_password(value):
    return hasher.hash(value)


def verify_password(hashed, value):
    try:
        return hasher.verify(hashed, value)
    except (VerificationError, InvalidHashError):
        return False


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()
