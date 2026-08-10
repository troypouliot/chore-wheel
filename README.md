# Chore Wheel

A self-hosted kiosk app: kids pick their name, spin a wheel of chores (and
occasional prizes), and you manage everything — chores, prizes, kids, spins
per day — from a browser on any other device on your network.

**Setup:** the backend (FastAPI + SQLite) runs on your home server. The
Raspberry Pi's touchscreen just runs Chromium in kiosk mode pointed at the
server — it does no processing of its own and holds no data.

## What's here

```
chore-wheel/
├── app/
│   ├── main.py          FastAPI app (kiosk + admin API)
│   ├── db.py            SQLite setup/helpers
│   ├── schema.sql       Database schema
│   ├── templates/
│   │   ├── kiosk.html   The wheel screen kids use
│   │   └── admin.html   Password-protected admin panel
│   ├── static/          CSS/JS for both pages
│   └── data/            SQLite DB file lives here at runtime
├── deploy/
│   ├── server/
│   │   └── chorewheel.service           systemd unit for the backend — install on your home server
│   └── pi/
│       ├── chorewheel-kiosk.service     systemd unit for Chromium kiosk mode — install on the Pi
│       ├── chorewheel-killswitch.service systemd unit for the local kill-switch/keyboard helper — install on the Pi
│       └── chorewheel-onboard.service   systemd unit to keep the onboard keyboard running — install on the Pi
├── pi-helper/
│   ├── kiosk_kill_switch.py  Local-only helper the kiosk page calls to exit Chromium (see below)
│   └── desktop-shortcut/     One-tap desktop icon to restart the kiosk (see below)
├── requirements.txt
└── README.md
```

## 1. Install the backend on your home server

This app is small (one Python process, one SQLite file), so it runs
comfortably alongside your Home Assistant VM directly on the host — no
separate VM needed for it.

Create a dedicated, unprivileged user so it's isolated from your own login
and from the Home Assistant VM:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin chorewheel
```

Copy this whole project to `/opt/chorewheel` and set ownership:

```bash
sudo mkdir -p /opt/chorewheel
sudo cp -r chore-wheel/* /opt/chorewheel/
sudo chown -R chorewheel:chorewheel /opt/chorewheel
```

Install dependencies as that user:

```bash
sudo -u chorewheel python3 -m venv /opt/chorewheel/venv
sudo -u chorewheel /opt/chorewheel/venv/bin/pip install -r /opt/chorewheel/requirements.txt
```

Do a quick manual test run:

```bash
sudo -u chorewheel /opt/chorewheel/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 \
  --app-dir /opt/chorewheel/app
```

Visit `http://<server-ip>:8000/` from your laptop or phone — you should see
the kid-selection screen with two placeholder kids and a starter set of
chores. Find the server's IP with `hostname -I` (or however you found it for
your Home Assistant VM). Stop it with Ctrl+C once confirmed.

## 2. Run the backend automatically on boot (on the server)

```bash
sudo cp /opt/chorewheel/deploy/server/chorewheel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chorewheel.service
```

Check it's running: `sudo systemctl status chorewheel.service`, or reload
`http://<server-ip>:8000/` from another device.

If you used a different path than `/opt/chorewheel` or a different user,
edit `WorkingDirectory=`, `ExecStart=`, `User=`, and `Group=` in
`deploy/server/chorewheel.service` before copying it in.

If your server has a firewall enabled (e.g. `ufw`), open the port:

```bash
sudo ufw allow 8000/tcp
```

## 3. Point the Pi at the server

The Pi only needs Chromium in kiosk mode now — no Python, no venv, nothing
from `requirements.txt`. Copy just the kiosk unit file over:

```bash
sudo cp chore-wheel/deploy/pi/chorewheel-kiosk.service /etc/systemd/system/
```

Edit `/etc/systemd/system/chorewheel-kiosk.service` and replace
`CHOREWHEEL_SERVER_IP` with your server's LAN IP (or hostname, if you've set
up mDNS/DHCP reservation — see notes below), then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now chorewheel-kiosk.service
```

Reboot the Pi (`sudo reboot`) and the touchscreen should boot straight into
the wheel, full-screen, no browser chrome — now being served entirely from
your home server.

**If you previously had `chorewheel.service` (the backend) installed on the
Pi from an earlier setup**, disable and remove it — the Pi doesn't need it
anymore:

```bash
sudo systemctl disable --now chorewheel.service
sudo rm /etc/systemd/system/chorewheel.service
```

**If your Pi boots to desktop with auto-login already**, this systemd
approach works well. If it's set up differently (e.g. you already have an
`~/.config/lxsession/LXDE-pi/autostart` entry launching something else),
it's simpler to skip `chorewheel-kiosk.service` and instead add this line to
that autostart file (with your server's IP):

```
@chromium-browser --kiosk --noerrdialogs --disable-infobars http://<server-ip>:8000/
```

Either approach works — use whichever fits how the Pi is already configured.

## 4. On-screen keyboard (onboard)

Needed for typing the admin password and editing chores/prizes directly on
the touchscreen. This assumes X11 (not Wayland) — check with
`echo $XDG_SESSION_TYPE` on the Pi if unsure.

```bash
sudo apt install -y onboard onboard-data at-spi2-core
gsettings set org.gnome.desktop.interface toolkit-accessibility true
```

Keep it running reliably in the background via systemd, rather than relying
on the desktop's autostart file (easy to lose track of, and not obviously
connected to this project if you look at it again in a year):

```bash
sudo cp chore-wheel/deploy/pi/chorewheel-onboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chorewheel-onboard.service
```

**If you'd previously added `@onboard` to
`~/.config/lxsession/LXDE-pi/autostart`**, remove that line now — running
onboard both ways at once can cause two instances to conflict over the same
D-Bus name, which would make the keyboard toggle button (below) unreliable.

Chromium's own auto-show for onboard is unreliable, so don't rely on it —
the keyboard toggle button set up in the next section is the intended way
to bring it up on demand.

## 5. Install the Pi local-control helper (exit switch + keyboard toggle)

Kiosk mode has no visible way out, and Chromium's auto-show for the
on-screen keyboard is unreliable. Both problems are solved by the same
tiny local-only helper on the Pi: a hidden gesture on the kiosk page closes
Chromium, and a small always-visible button toggles the onboard keyboard
directly via its D-Bus API (bypassing Chromium's flaky auto-show entirely).

**Exit gesture:** tap the top-left 60x60px corner of the screen 5 times
within 3 seconds. A confirmation dialog appears — confirming it force-closes
Chromium, dropping you back to the desktop. There's no visible hint that
this exists; it's meant to be an escape hatch you remember, not a button
kids would stumble onto.

**Keyboard button:** a small circular ⌨ button, bottom-right corner, on
both the kiosk and admin pages. Tapping it shows/hides onboard regardless
of what Chromium's accessibility tree is or isn't reporting. Requires
onboard to already be running in the background (see the earlier onboard
setup step) — if it isn't, the button briefly flashes red to signal
failure rather than doing nothing silently. This button is harmless if
someone loads the admin page from a phone or another computer — it'll just
try to reach `localhost` on *that* device, find nothing listening, and
flash red; it only actually does anything when loaded on the Pi itself.

The helper listens **only on `127.0.0.1` on the Pi itself** — it's never
reachable from the network, including from the server or other devices.

Copy the helper script and its systemd unit to the Pi (via WinSCP or `scp`,
same as the rest):

```bash
mkdir -p ~/chore-wheel/pi-helper
# copy pi-helper/kiosk_kill_switch.py to ~/chore-wheel/pi-helper/ on the Pi
sudo cp chore-wheel/deploy/pi/chorewheel-killswitch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chorewheel-killswitch.service
```

Check it's running:
```bash
sudo systemctl status chorewheel-killswitch.service
```

If your Pi user isn't `pi` or the project isn't at `/home/pi/chore-wheel`,
edit the `ExecStart=` path in `deploy/pi/chorewheel-killswitch.service`
before copying it in.

**Note:** the exit gesture only closes Chromium — it doesn't affect
`chorespinner.service` itself (the kiosk browser service — see the note
below on naming). By default that service now has `Restart=no` (see the
next section for why), so once you use the kill switch, Chromium stays
closed until you relaunch it — either with the desktop shortcut below, or
`sudo systemctl start chorespinner.service`. If you'd rather it always
relaunch itself automatically after any crash, change `Restart=no` back to
`Restart=on-failure` in the service file.

## 6. Manually restarting the kiosk from the Pi's desktop

Since auto-restart is off by default, the kiosk needs a manual nudge to
come back after using the kill switch (or after any change you're testing).
This adds a one-tap desktop icon that restarts it — no terminal, no typed
password needed.

**1. Allow the restart command to run without a sudo password** (scoped to
just this one command, nothing broader):

```bash
sudo cp chore-wheel/pi-helper/desktop-shortcut/chorewheel-restart-sudoers /etc/sudoers.d/chorewheel-restart
sudo chmod 440 /etc/sudoers.d/chorewheel-restart
sudo visudo -c   # validates the syntax before it takes effect
```

**2. Make the restart script executable and copy the shortcut to the desktop:**

```bash
chmod +x chore-wheel/pi-helper/desktop-shortcut/restart-kiosk.sh
cp chore-wheel/pi-helper/desktop-shortcut/restart-chorewheel.desktop ~/Desktop/
chmod +x ~/Desktop/restart-chorewheel.desktop
```

**3. Trust the shortcut.** Raspberry Pi OS's file manager blocks
newly-copied `.desktop` files from running until you approve them once —
right-click the new "Restart Chore Wheel" icon on the desktop and choose
**"Execute"** (or **"Allow Launching"**, wording varies by OS version). This
is a one-time step.

After that, tapping the icon restarts `chorewheel-kiosk.service`, which
kills any running Chromium and launches a fresh one pointed at your server.

If your service is actually named something other than
`chorewheel-kiosk.service` (e.g. you renamed it `chorespinner.service`
along the way), update that name in both
`pi-helper/desktop-shortcut/restart-kiosk.sh` and
`pi-helper/desktop-shortcut/chorewheel-restart-sudoers` before installing.

## 7. Managing it day-to-day

From any phone, tablet, or computer on the same network:

- **Kiosk view (read-only):** `http://<server-ip>:8000/`
- **Admin panel:** `http://<server-ip>:8000/admin`

Default admin password is `chorewheel` — log in once and change it under the
Settings tab. There's no separate user accounts system; it's a single shared
admin password for whichever parent needs to make changes, by design, to
keep this simple for a home setup.

In the admin panel you can:
- Add/edit/delete kids, and set each kid's spins-per-day
- Add/edit/delete wheel items — mark each as a **chore** or **prize**, and
  set a relative **weight** (a weight-3 item is 3x as likely to come up as a
  weight-1 item — handy for making prizes rarer than chores)
- Reset a kid's spins for today (e.g. if a spin was a misclick)
- View recent spin history
- Change the admin password

Changes made in the admin panel show up on the kiosk within 30 seconds
(it polls automatically), or instantly on the next "Back" tap.

## 8. Notes on the setup

- **Storage:** everything lives in a single SQLite file at
  `app/data/chorewheel.db` **on the server**. Back it up by copying that one
  file (e.g. into whatever backup routine you already have for the Home
  Assistant VM's host).
- **Network:** the app binds to `0.0.0.0:8000` on the server, so it's
  reachable from any device on your LAN, including the Pi. It is **not**
  exposed to the internet — don't port-forward 8000 unless you add HTTPS and
  stronger auth first.
- **Finding the server's IP:** it's worth giving the server a fixed DHCP
  reservation in your router (you may already have done this for the Home
  Assistant VM) so the address doesn't change and the Pi's kiosk unit never
  needs updating. Alternatively, if your server has mDNS/Avahi running,
  `http://<hostname>.local:8000/` often works without needing to hardcode an
  IP at all — swap that in for `CHOREWHEEL_SERVER_IP` in the Pi's service
  file.
- **The Pi has no state of its own.** If you ever swap the touchscreen for a
  different device, all you need is Chromium pointed at
  `http://<server-ip>:8000/` — nothing to migrate.
- **Odds:** the spin picks randomly from active items weighted by their
  `weight` value — chores and prizes are just tagged differently for display
  (and to log which was won), they compete in the same draw.
- **Multiple kids' devices:** this is designed for one shared kiosk screen
  where a kid taps their own name first, not one instance per kid.

## 9. If you want to extend it later

- Add a "streak" bonus (e.g. extra spin after 5 chore-days in a row) — the
  `spins` table already has everything needed to compute streaks.
- Push a completion notification to Home Assistant via a simple `POST` from
  `main.py` after each spin (e.g. call a Home Assistant webhook) if you want
  it to show up on your existing dashboards.
- Swap the single shared admin password for per-parent logins if that ever
  matters to you — the auth layer is isolated in `main.py`'s session/login
  section, so it's a contained change.
