// Receipt printer + cash drawer.
// Three ways to reach the printer, picked in Hardware Setup on the register:
//   raw     — a Windows printer (USB or installed), sent ESC/POS directly. Best for receipt printers.
//   network — a printer on the network at IP:9100 (Ethernet or Wi-Fi receipt printers).
//   driver  — normal Windows printing through the printer's driver (no drawer or cut commands).
// The cash drawer plugs into the receipt printer and opens with the ESC/POS "kick" command.
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ESC = 0x1b, GS = 0x1d;
const SWAP = { '·': '-', '•': '*', '…': '...', '→': '->', '—': '-', '–': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '×': 'x', '¢': 'c' };
function encode(text) {
  const s = String(text ?? '').replace(/[·•…→—–’‘“”×¢]/g, c => SWAP[c]);
  return [...s].map(c => { const n = c.charCodeAt(0); return n >= 32 && n < 127 ? n : 0x3f; });
}

// job: { lines: [{ text, align: 'left'|'center', bold, big }], cut, drawer }
function escpos(job) {
  const out = [ESC, 0x40]; // reset
  for (const l of job.lines || []) {
    const line = typeof l === 'string' ? { text: l } : l;
    out.push(ESC, 0x61, line.align === 'center' ? 1 : 0);
    out.push(ESC, 0x45, line.bold ? 1 : 0);
    out.push(GS, 0x21, line.big ? 0x11 : 0x00);
    out.push(...encode(line.text), 0x0a);
  }
  out.push(ESC, 0x45, 0, GS, 0x21, 0, ESC, 0x61, 0);
  if ((job.lines || []).length) out.push(0x0a, 0x0a, 0x0a, 0x0a);
  if (job.cut) out.push(GS, 0x56, 0x42, 0x00);         // feed and partial cut
  if (job.drawer) out.push(ESC, 0x70, 0x00, 0x19, 0xfa); // kick drawer pin 2
  return Buffer.from(out);
}

function sendNetwork(ip, port, buf) {
  return new Promise((resolve, reject) => {
    if (!ip) return reject(new Error('Enter the printer IP address in Hardware Setup.'));
    const sock = net.createConnection({ host: ip, port: Number(port) || 9100 });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`Printer at ${ip} did not answer.`)); }, 6000);
    sock.on('connect', () => { sock.write(buf, () => sock.end()); });
    sock.on('close', () => { clearTimeout(timer); resolve(); });
    sock.on('error', e => { clearTimeout(timer); reject(new Error(`Printer at ${ip}: ${e.message}`)); });
  });
}

// Sends raw bytes to a Windows printer through the Windows print spooler (no extra software needed).
const RAW_PS1 = `param([string]$Printer, [string]$Path)
$ErrorActionPreference = 'Stop'
$code = @"
using System;
using System.Runtime.InteropServices;
public class BuddysRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("Printer not found: " + printer);
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "Buddys receipt"; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("Could not start the print job");
      StartPagePrinter(h);
      int written; WritePrinter(h, data, data.Length, out written);
      EndPagePrinter(h); EndDocPrinter(h);
    } finally { ClosePrinter(h); }
  }
}
"@
Add-Type -TypeDefinition $code
[BuddysRawPrint]::Send($Printer, [System.IO.File]::ReadAllBytes($Path))
`;
function sendWindowsRaw(name, buf) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Windows printing only works on Windows.'));
    if (!name) return reject(new Error('Pick the receipt printer in Hardware Setup.'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddys-'));
    const script = path.join(dir, 'raw.ps1'), data = path.join(dir, 'job.bin');
    fs.writeFileSync(script, RAW_PS1); fs.writeFileSync(data, buf);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Printer', name, '-Path', data],
      { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        if (err) return reject(new Error((stderr || err.message).split('\n').find(l => l.trim()) || 'Printing failed'));
        resolve();
      });
  });
}

// Normal Windows printing (for printers that don't take ESC/POS). Prints the receipt as a page.
function sendDriver(win, name, job) {
  const { BrowserWindow } = require('electron');
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = `<html><body style="margin:0;font:12px/1.35 Consolas,monospace;width:72mm"><pre style="margin:0;white-space:pre-wrap">${(job.lines || []).map(l => {
    const t = esc(typeof l === 'string' ? l : l.text); return (l && l.bold) ? `<b>${t}</b>` : t; }).join('\n')}</pre></body></html>`;
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).then(() => {
      w.webContents.print({ silent: true, deviceName: name || undefined, printBackground: false, margins: { marginType: 'none' } }, (ok, reason) => {
        w.destroy(); ok ? resolve() : reject(new Error(reason || 'Printing failed'));
      });
    }).catch(e => { w.destroy(); reject(e); });
  });
}

async function print(settings, job, win) {
  if (settings.mode === 'driver') {
    if ((job.lines || []).length) await sendDriver(win, settings.printerName, job);
    return;
  }
  const buf = escpos(job);
  if (settings.mode === 'network') return sendNetwork(settings.ip, settings.port, buf);
  return sendWindowsRaw(settings.printerName, buf);
}
async function drawer(settings) {
  if (settings.mode === 'driver') throw new Error('With normal Windows printing, the drawer opens from the printer driver settings.');
  return print(settings, { lines: [], drawer: true });
}

module.exports = { print, drawer, escpos, encode };
