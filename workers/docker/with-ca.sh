#!/bin/sh
# Voert een build-commando uit met een optionele extra CA (BuildKit-secret "ca_bundle"), voor builds achter een
# TLS-inspecterende proxy. Zonder secret verandert er niets; het certificaat komt nooit in een image-laag.
set -e
if [ -f /run/secrets/ca_bundle ]; then
  export SSL_CERT_FILE=/run/secrets/ca_bundle PIP_CERT=/run/secrets/ca_bundle REQUESTS_CA_BUNDLE=/run/secrets/ca_bundle \
         NODE_EXTRA_CA_CERTS=/run/secrets/ca_bundle
  echo 'Acquire::https::CAInfo "/run/secrets/ca_bundle";' > /etc/apt/apt.conf.d/99-build-ca
fi
status=0
"$@" || status=$?
rm -f /etc/apt/apt.conf.d/99-build-ca
exit $status
