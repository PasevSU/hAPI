# hAPI Enterprise — User Guide

## What is hAPI Enterprise

A professional Home Assistant add-on for document processing, QR-based sharing, and
cryptographic proof of authenticity for courts and prosecutors.

## Quick start

1. Install the add-on.
2. Open the **Admin console** (Ingress or `http://127.0.0.1:8098/admin`).
3. Create a **group** and a **profile** (directory / cabinet).
4. Upload a document — it is hashed and versioned automatically.

## Sharing via QR code

1. Open the file → **Share**.
2. Set an expiry and optional PIN.
3. Generate a **QR code**.
4. The recipient scans and opens the protected portal.

## Verifying evidence

1. Download the document, manifest, signature, and timestamp.
2. Open the portal → **Verify**.
3. SHA-256/SHA-512 are recomputed; the signature (PKCS#7) and timestamp
   (RFC 3161) are verified.
4. Green = the document has not been tampered with.

## FAQ

- **What does the QR code prove?** Not just a link — cryptographically bound data:
  hash, signature, and timestamp that a court can verify independently.
- **Is forgery a thing of the past?** Yes — any change alters the hash and the
  verification fails.
