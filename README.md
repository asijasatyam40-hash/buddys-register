# Buddy's Register — Windows app

The register screen as a real Windows program:
- **Works offline.** Items, prices and employees are kept on the PC. Sales upload when the internet is back.
- **Updates itself.** A new version downloads in the background and installs when the register is closed, or between 3 and 5 AM when nobody is signed in. Never during a sale.
- **Prints receipts and opens the cash drawer.** It works with a USB receipt printer installed in Windows, a network receipt printer (IP address), or normal Windows printing.
- **Opens full screen** and can start with Windows.

GitHub builds the installer for you, free, on its own Windows computers. You never install programming tools.

---

## One-time setup (about 20 minutes)

### 1. Make a GitHub account and a place for the app
1. Go to **github.com** and sign up (free), or sign in.
2. Click **+** (top right) → **New repository**.
   - Name: `buddys-register`
   - Choose **Public**. Registers download updates from here without a password. Nothing secret is in these files.
   - Click **Create repository**.

### 2. Upload the app files
1. On the new repository page, click **uploading an existing file**.
2. Open the unzipped **buddys-register-app** folder. Select **everything inside it** (including the `.github` folder) and drag it onto the GitHub page.
3. Scroll down and click **Commit changes**.

> If the `.github` folder didn't upload: click **Add file → Create new file**, type the name `.github/workflows/build.yml`, paste in the contents of that file from the folder, and click **Commit changes**.

### 3. Let GitHub build the installer
1. Click the **Actions** tab. You'll see **Build register app** running (yellow dot).
2. Wait about 5–8 minutes until it turns green ✓.
3. Click **Code**, then on the right side under **Releases** click **v1.0.0**.
4. Download **Buddys-Register-Setup-1.0.0.exe**.

If it shows a red ✗, click it, take a screenshot, and send it to me.

### 4. Install on the register PC
1. Copy the Setup file to the register PC (USB stick, or download it there) and double-click it.
2. Windows may show **"Windows protected your PC"**, because the app isn't signed with a paid certificate. Click **More info → Run anyway**.
3. Buddy's Register opens full screen. A desktop icon is added.

### 5. Connect and set up the hardware
1. Sign in with test PIN **9999**, then tap **Later** for the drawer.
2. **Commands → Connect to Cloud.** Enter your Back Office email and password, then choose the store and register number.
3. Sign in with **your Back Office PIN**.
4. **Commands → Hardware Setup:**
   - **Windows printer** for a USB receipt printer. Pick it from the list.
   - **Network (IP)** for a network receipt printer. Type its IP address (print the printer's self-test page to find it).
   - Tap **Test print** and **Open drawer**. If both work, tap **Save**.

---

## Sending out an update later
When I send you a new version:
1. Open the repository on GitHub → **Add file → Upload files**.
2. Drag in the changed files (always including `package.json`, which has the new version number) → **Commit changes**.
3. GitHub builds it (5–8 minutes). Every register downloads it by itself and installs it when closed or overnight.

## If something goes wrong
- **Receipt prints garbage or nothing:** try **Normal printing** mode in Hardware Setup. Some printers only take their Windows driver.
- **Drawer doesn't open:** the drawer cable must be plugged into the **printer** (the jack marked DK or Drawer), not the PC.
- **Close the app:** Commands → **Close Register** (manager PIN). If a ticket is open, it won't close until you finish, hold or void it.
- **Log file** for troubleshooting: `%APPDATA%\Buddy's Register\register.log`
