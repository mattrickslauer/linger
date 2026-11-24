#!/usr/bin/env python3
"""Makes sure an Apple Distribution certificate and an App Store provisioning profile exist for the app,
using the App Store Connect API key. No Mac, no registered devices, no Xcode account needed.

  python3 ios/scripts/asc_signing.py <out_dir>

Reads ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (optional) from the environment.
Secrets live in ~/Documents/AuthCodes/verified-ios/ (never in the repo):
  dist.key.pem   private key of the distribution certificate (created once, reused)
  dist.cert-id   App Store Connect id of that certificate
Writes into <out_dir> (a temp dir that remote-build.sh deletes): dist.p12, dist.p12.pass, profile.mobileprovision
Prints one JSON line: {"profile_name": ..., "profile_uuid": ...}
"""
import base64, json, os, secrets, sys, time, urllib.error, urllib.parse, urllib.request

import jwt
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

BUNDLE = "com.mattrickslauer.verified"
PROFILE_NAME = "Verified App Store"  # must match PROVISIONING_PROFILE_SPECIFIER in ios/project.yml
KEY_ID = os.environ["ASC_KEY_ID"]
ISSUER = os.environ["ASC_ISSUER_ID"]
KEY_PATH = os.path.expanduser(os.environ.get("ASC_KEY_PATH") or f"~/Documents/AuthCodes/AuthKey_{KEY_ID}.p8")
STORE = os.path.expanduser("~/Documents/AuthCodes/verified-ios")


def api(method, path, body=None):
    now = int(time.time())
    tok = jwt.encode({"iss": ISSUER, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"},
                     open(KEY_PATH).read(), algorithm="ES256", headers={"kid": KEY_ID, "typ": "JWT"})
    req = urllib.request.Request("https://api.appstoreconnect.apple.com" + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"App Store Connect {method} {path} -> HTTP {e.code}: {e.read().decode()[:600]}")


def distribution_cert():
    """Returns (private_key, x509 cert), creating and storing them on first use."""
    os.makedirs(STORE, mode=0o700, exist_ok=True)
    key_file, id_file = f"{STORE}/dist.key.pem", f"{STORE}/dist.cert-id"
    if os.path.exists(key_file) and os.path.exists(id_file):
        key = serialization.load_pem_private_key(open(key_file, "rb").read(), None)
        cert_id = open(id_file).read().strip()
        d = api("GET", f"/v1/certificates?filter[id]={cert_id}&limit=1").get("data", [])
        if d:
            return key, cert_id, x509.load_der_x509_certificate(base64.b64decode(d[0]["attributes"]["certificateContent"]))
        print("stored distribution certificate is gone (revoked/expired); creating a new one", file=sys.stderr)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    csr = (x509.CertificateSigningRequestBuilder()
           .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Verified iOS distribution")]))
           .sign(key, hashes.SHA256()))
    d = api("POST", "/v1/certificates", {"data": {"type": "certificates", "attributes": {
        "certificateType": "DISTRIBUTION",
        "csrContent": csr.public_bytes(serialization.Encoding.PEM).decode()}}})["data"]
    with open(key_file, "wb", opener=lambda p, f: os.open(p, f, 0o600)) as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                  serialization.NoEncryption()))
    open(id_file, "w").write(d["id"])
    return key, d["id"], x509.load_der_x509_certificate(base64.b64decode(d["attributes"]["certificateContent"]))


def app_store_profile(cert_id):
    """Recreates the App Store profile so it always carries the current certificate and capabilities."""
    bundle = api("GET", f"/v1/bundleIds?filter[identifier]={BUNDLE}&limit=5")["data"]
    bundle_id = next(b["id"] for b in bundle if b["attributes"]["identifier"] == BUNDLE)
    for p in api("GET", f"/v1/profiles?filter[name]={urllib.parse.quote(PROFILE_NAME)}&limit=50").get("data", []):
        api("DELETE", f"/v1/profiles/{p['id']}")
    return api("POST", "/v1/profiles", {"data": {"type": "profiles",
        "attributes": {"name": PROFILE_NAME, "profileType": "IOS_APP_STORE"},
        "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bundle_id}},
                          "certificates": {"data": [{"type": "certificates", "id": cert_id}]}}}})["data"]["attributes"]


def main():
    out = sys.argv[1]
    os.makedirs(out, mode=0o700, exist_ok=True)
    key, cert_id, cert = distribution_cert()
    pw = secrets.token_hex(16)
    # Legacy PKCS#12 encryption (3DES/SHA1): macOS `security import` rejects the modern AES default.
    enc = (serialization.PrivateFormat.PKCS12.encryption_builder().kdf_rounds(50000)
           .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(pw.encode()))
    open(f"{out}/dist.p12", "wb").write(pkcs12.serialize_key_and_certificates(b"Verified distribution", key, cert, None, enc))
    open(f"{out}/dist.p12.pass", "w").write(pw)
    prof = app_store_profile(cert_id)
    open(f"{out}/profile.mobileprovision", "wb").write(base64.b64decode(prof["profileContent"]))
    print(json.dumps({"profile_name": PROFILE_NAME, "profile_uuid": prof["uuid"]}))


if __name__ == "__main__":
    main()
