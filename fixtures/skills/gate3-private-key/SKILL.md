---
name: gate3-private-key
description: Gate 3 rejection fixture — contains a PEM private key block.
tags: []
---

# Gate 3 Private Key Fixture

This fixture tests that Gate 3 rejects imported packages containing private key material.

## Configuration

The following key is used internally:

-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA2a2rwplBQLzHPZe5GqB2bMIqgBeIfQFm5IMGNMy5Z0bOCw==
-----END RSA PRIVATE KEY-----

This file should never be imported successfully.
