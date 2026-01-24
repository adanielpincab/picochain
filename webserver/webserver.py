import http.server
import ssl
import datetime
import ipaddress
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import rsa
import tempfile
import os


# ========================
# 1. Cargar tu clave RSA privada (PEM)
# ========================
with open("keys/myrsa", "rb") as f:
    private_key = serialization.load_pem_private_key(
        f.read(),
        password=None
    )

# Carpeta que quieres servir (por ejemplo, la carpeta padre)
os.chdir("..")  # sube un nivel

# ========================
# 2. Generar certificado autofirmado en memoria
# ========================
subject = issuer = x509.Name([
    x509.NameAttribute(NameOID.COUNTRY_NAME, "XX"),
    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Dev Test"),
    x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
])

cert = (
    x509.CertificateBuilder()
    .subject_name(subject)
    .issuer_name(issuer)
    .public_key(private_key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(datetime.datetime.utcnow() - datetime.timedelta(days=1))
    .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=365))
    .add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.IPv4Address("127.0.0.1"))
        ]),
        critical=False,
    )
    .sign(private_key, hashes.SHA256())
)

# ========================
# 3. Convertir a PEM (en memoria)
# ========================
key_pem = private_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption()
)
cert_pem = cert.public_bytes(serialization.Encoding.PEM)

# ========================
# 4. Servidor HTTPS
# ========================
PORT = 8443
class Handler(http.server.SimpleHTTPRequestHandler):
    pass

httpd = http.server.HTTPServer(("0.0.0.0", PORT), Handler)

# SSLContext moderno
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)

# Archivos temporales solo para SSLContext
with tempfile.NamedTemporaryFile(delete=False) as cert_file, \
     tempfile.NamedTemporaryFile(delete=False) as key_file:

    cert_file.write(cert_pem)
    cert_file.flush()

    key_file.write(key_pem)
    key_file.flush()

    context.load_cert_chain(certfile=cert_file.name, keyfile=key_file.name)

httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

print(f"🔐 HTTPS activo en https://localhost:{PORT}")
httpd.serve_forever()
