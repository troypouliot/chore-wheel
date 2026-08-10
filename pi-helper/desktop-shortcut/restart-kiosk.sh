#!/bin/bash
# Restarts the kiosk browser service. Uses sudo without a password prompt —
# see the sudoers rule in deploy/pi/chorewheel-restart-sudoers for the
# narrow, single-command permission that makes this safe to do.
sudo systemctl restart chorewheel-kiosk.service
