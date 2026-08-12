# Chore Wheel

A self-hosted kiosk app: kids pick their name, spin a wheel of chores (and
occasional prizes), and you manage everything — chores, prizes, kids, spins
per day — from a browser on any other device on your network.

**Setup:** the backend (FastAPI + SQLite) runs on your home server. The
Raspberry Pi's touchscreen just runs Chromium in kiosk mode pointed at the
server — it does no processing of its own and holds no data.

**Source of truth:** both the server and the Pi run off the same public git
repo. Update either one with `git pull` + a service restart — see
"Keeping it updated" near the end.

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
│   └── data/            SQLite DB file lives here at runtime (gitignored)
├── deploy/
│   ├── server/
│   │   └── chorewheel.service           systemd unit for the backend — install on your home server
│   └── pi/
│       ├── chorespinner.service         systemd unit for Chromium kiosk mode — install on the Pi
│       ├── chorewheel-killswitch.service systemd unit for the local kill-switch helper — install on the Pi
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

Clone the repo somewhere in your own home directory (this example uses
`/home/pouliot/chore-wheel` — swap in your actual username/path throughout
this doc if different):

```bash
cd ~
git clone https://github.com/<your-username>/<your-repo>.git chore-wheel
cd chore-wheel
```

Set up the virtual environment and install dependencies:

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

Do a quick manual test run:

```bash
./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir app
```

Visit `http://<server-ip>:8000/` from your laptop or phone — you should see
the kid-selection screen with two placeholder kids and a starter set of
chores. Find the server's IP with `hostname -I` (or however you found it for
your Home Assistant VM). Stop it with Ctrl+C once confirmed.

**Note on running as your own user rather than a dedicated system account:**
an earlier version of this setup used a separate unprivileged `chorewheel`
system user for isolation. Since the code now lives inside your own home
directory under git, that user can't traverse into it (home directories are
private by default), so the service instead runs as you. The systemd unit
below still applies some sandboxing (`ProtectSystem=strict` etc.) to keep it
reasonably contained even though it's running as your own account.

## 2. Run the backend automatically on boot (on the server)

```bash
sudo cp deploy/server/chorewheel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chorewheel.service
```

Check it's running: `sudo systemctl status chorewheel.service`, or reload
`http://<server-ip>:8000/` from another device.

The shipped unit file assumes the repo is at `/home/pouliot/chore-wheel` and
runs as user `pouliot`. If your username or path is different, edit
`WorkingDirectory=`, `ExecStart=`, `User=`, `Group=`, and `ReadWritePaths=`
in `deploy/server/chorewheel.service` before copying it in — all five need
to agree, or you'll hit a
`Changing to the requested working directory failed: Permission denied`
error (status `200/CHDIR`) on start.

If your server has a firewall enabled (e.g. `ufw`), open the port:

```bash
sudo ufw allow 8000/tcp
```

## 3. Point the Pi at the server

The Pi only needs Chromium in kiosk mode — the app's Python dependencies
aren't needed there. Still, since the Pi now also pulls from the same git
repo (for the kill-switch helper and any future Pi-side changes), clone the
whole thing to the Pi too:

```bash
cd ~
git clone https://github.com/<your-username>/<your-repo>.git chore-wheel
```

Install the kiosk browser service — **note this systemd unit is installed
under the name `chorespinner.service`**, not the source filename:

```bash
sudo cp ~/chore-wheel/deploy/pi/chorespinner.service /etc/systemd/system/chorespinner.service
```

Edit `/etc/systemd/system/chorespinner.service` and replace
`CHOREWHEEL_SERVER_IP` with your server's LAN IP (or hostname, if you've set
up mDNS/DHCP reservation — see notes below), then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now chorespinner.service
```

Reboot the Pi (`sudo reboot`) and the touchscreen should boot straight into
the wheel, full-screen, no browser chrome — served entirely from your home
server.

**Launch flags worth knowing about:** the unit launches Chromium with
`--app=<url>` rather than passing the URL as a plain argument. `--app` mode
loads the page directly with no address bar at all — this specifically
fixes an issue where, on some boots, the correct URL would show in the
address bar but never actually navigate (as if Enter was never pressed).
`--disable-session-crashed-bubble` is also included, since our kill switch
force-kills Chromium rather than closing it gracefully, which can otherwise
trigger a "restore pages?" prompt on the next launch.

**By default, this service does NOT auto-restart on crash**
(`Restart=no`) — see the kill-switch section below for why, and the desktop
shortcut section for how to relaunch it manually. If you'd rather it always
come back on its own, change `Restart=no` to `Restart=on-failure` in the
unit file.

**If you previously had `chorewheel.service` (the backend) installed on the
Pi from an earlier setup**, disable and remove it — the Pi doesn't run the
backend anymore:

```bash
sudo systemctl disable --now chorewheel.service
sudo rm /etc/systemd/system/chorewheel.service
```

**If your Pi boots to desktop with auto-login already**, this systemd
approach works well. If it's set up differently (e.g. you already have an
`~/.config/lxsession/LXDE-pi/autostart` entry launching something else),
it's simpler to skip the systemd unit and instead add a line to that
autostart file (with your server's IP):

```
@chromium --kiosk --app=http://<server-ip>:8000/ --password-store=basic
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
sudo cp ~/chore-wheel/deploy/pi/chorewheel-onboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chorewheel-onboard.service
```

**If you'd previously added `@onboard` to
`~/.config/lxsession/LXDE-pi/autostart`**, remove that line now to avoid two
onboard instances conflicting with each other.

**Auto-show doesn't work reliably** — Chromium's accessibility reporting to
onboard is flaky, so don't count on the keyboard popping up automatically
when you tap a text field. (An earlier attempt at an in-page toggle button
using onboard's D-Bus API didn't end up working reliably either, and was
removed.) For now, bring it up manually when needed:

```bash
onboard &
```

run from a terminal on the Pi, or consider leaving it permanently docked at
the bottom of the screen instead of relying on any kind of show/hide at
all, if you're typing on it often enough that summoning it manually gets
tedious.

## 5. Install the Pi kill-switch helper (exit-kiosk escape hatch)

Kiosk mode has no visible way out if you get stuck. This installs a tiny
local-only helper on the Pi that a hidden gesture on the kiosk page
triggers to close Chromium.

**How it works:** tap the top-left 60x60px corner of the screen 5 times
within 3 seconds. A confirmation dialog appears — confirming it force-closes
Chromium, dropping you back to the desktop. There's no visible hint that
this exists; it's meant to be an escape hatch you remember, not a button
kids would stumble onto.

The helper listens **only on `127.0.0.1` on the Pi itself** — it's never
reachable from the network, including from the server or other devices.

Since it's already part of the git clone, just install the systemd unit:

```bash
sudo cp ~/chore-wheel/deploy/pi/chorewheel-killswitch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chorewheel-killswitch.service
```

Check it's running:
```bash
sudo systemctl status chorewheel-killswitch.service
```

If your Pi user isn't `pi` or the repo isn't at `/home/pi/chore-wheel`, edit
the `ExecStart=` path (and the `DISPLAY`/`DBUS_SESSION_BUS_ADDRESS`
environment lines, which assume UID 1000 — check with `id -u pi` if unsure)
in `deploy/pi/chorewheel-killswitch.service` before copying it in.

**Note:** the exit gesture only closes Chromium — it doesn't affect
`chorespinner.service` itself. Since that service has `Restart=no` by
default, Chromium stays closed until you relaunch it — either with the
desktop shortcut below, or `sudo systemctl start chorespinner.service`.

## 6. Manually restarting the kiosk from the Pi's desktop

Since auto-restart is off by default, the kiosk needs a manual nudge to
come back after using the kill switch (or after any change you're testing).
This adds a one-tap desktop icon that restarts it — no terminal, no typed
password needed.

**1. Allow the restart command to run without a sudo password** (scoped to
just this one command, nothing broader):

```bash
sudo cp ~/chore-wheel/pi-helper/desktop-shortcut/chorewheel-restart-sudoers /etc/sudoers.d/chorewheel-restart
sudo chmod 440 /etc/sudoers.d/chorewheel-restart
sudo visudo -c   # validates the syntax before it takes effect
```

Confirm the sudoers rule references `chorespinner.service` (matching the
unit name we install in step 3) — if you're working from a version of this
file that still says `chorewheel-kiosk.service`, update it to match before
installing.

**2. Make the restart script executable and copy the shortcut to the desktop:**

```bash
chmod +x ~/chore-wheel/pi-helper/desktop-shortcut/restart-kiosk.sh
cp ~/chore-wheel/pi-helper/desktop-shortcut/restart-chorewheel.desktop ~/Desktop/
chmod +x ~/Desktop/restart-chorewheel.desktop
```

Same check as above — `restart-kiosk.sh` should call
`sudo systemctl restart chorespinner.service`.

**3. Trust the shortcut.** Raspberry Pi OS's file manager blocks
newly-copied `.desktop` files from running until you approve them once —
right-click the new "Restart Chore Wheel" icon on the desktop and choose
**"Execute"** (or **"Allow Launching"**, wording varies by OS version). This
is a one-time step.

After that, tapping the icon restarts `chorespinner.service`, which kills
any running Chromium and launches a fresh one pointed at your server.

## 7. Keeping it updated

Both machines pull from the same repo. Standard update loop:

**On the server:**
```bash
cd ~/chore-wheel
git pull
sudo systemctl restart chorewheel.service
```

**On the Pi:**
```bash
cd ~/chore-wheel
git pull
sudo systemctl restart chorespinner.service
```

Thanks to cache-busting built into the app, the Pi's browser picks up new
CSS/JS automatically on its next load after a server restart — no manual
cache-clearing needed.

**Two situations need an extra step:**

- **`requirements.txt` changed** on the server — install before restarting:
  ```bash
  git pull
  ./venv/bin/pip install -r requirements.txt
  sudo systemctl restart chorewheel.service
  ```
- **`pi-helper/` files changed** — restart that service too, on the Pi:
  ```bash
  sudo systemctl restart chorewheel-killswitch.service
  ```

**Sanity check after any restart:**
```bash
sudo systemctl status <service-name>
```
Should show `active (running)`. If it shows `failed`, check
`sudo journalctl -u <service-name> -e` for the actual error.

## 8. Managing it day-to-day

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

## 9. Notes on the setup

- **Storage:** everything lives in a single SQLite file at
  `app/data/chorewheel.db` **on the server** — gitignored, so it survives
  `git pull` untouched. Back it up by copying that one file (e.g. into
  whatever backup routine you already have for the Home Assistant VM's
  host).
- **Repo visibility:** this repo is public. Nothing sensitive is committed
  (the admin password isn't hardcoded; server/Pi IPs are left as
  placeholders you fill in locally, not committed values) — but if you ever
  hardcode something real while testing (an actual IP, a real password),
  double-check it's out before pushing, since git history isn't
  automatically scrubbed by a later commit.
- **Network:** the app binds to `0.0.0.0:8000` on the server, so it's
  reachable from any device on your LAN, including the Pi. It is **not**
  exposed to the internet — don't port-forward 8000 unless you add HTTPS and
  stronger auth first.
- **Finding the server's IP:** it's worth giving the server a fixed DHCP
  reservation in your router (you may already have done this for the Home
  Assistant VM) so the address doesn't change and the Pi's kiosk unit never
  needs updating. Alternatively, if your server has mDNS/Avahi running,
  `http://<hostname>.local:8000/` often works without needing to hardcode an
  IP at all.
- **The Pi has no state of its own.** If you ever swap the touchscreen for a
  different device, all you need is Chromium pointed at
  `http://<server-ip>:8000/` — nothing to migrate.
- **Odds:** the spin picks randomly from active items weighted by their
  `weight` value — chores and prizes are just tagged differently for display
  (and to log which was won), they compete in the same draw.
- **Multiple kids' devices:** this is designed for one shared kiosk screen
  where a kid taps their own name first, not one instance per kid.

## 10. If you want to extend it later

- Add a "streak" bonus (e.g. extra spin after 5 chore-days in a row) — the
  `spins` table already has everything needed to compute streaks.
- Push a completion notification to Home Assistant via a simple `POST` from
  `main.py` after each spin (e.g. call a Home Assistant webhook) if you want
  it to show up on your existing dashboards.
- Swap the single shared admin password for per-parent logins if that ever
  matters to you — the auth layer is isolated in `main.py`'s session/login
  section, so it's a contained change.
- Revisit a working keyboard auto-show for onboard, if the always-visible
  toggle-button approach is worth another attempt down the line.
