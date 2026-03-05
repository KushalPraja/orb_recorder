// Countdown overlay — fullscreen transparent window showing 3-2-1

import { BrowserWindow, screen } from 'electron';

/**
 * Show a fullscreen transparent countdown overlay.
 * Resolves when the countdown completes and the overlay closes.
 */
export function showCountdownOverlay(seconds = 3): Promise<void> {
  return new Promise((resolve) => {
    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.bounds;

    const overlay = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      fullscreen: false,
      resizable: false,
      movable: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
      },
    });

    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.setIgnoreMouseEvents(true);
    overlay.setContentProtection(true);

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    background:rgba(0,0,0,0.52);
    display:flex;align-items:center;justify-content:center;
    height:100vh;overflow:hidden;
    font-family:'JetBrains Mono','Fira Code','Cascadia Code','Courier New',monospace;
  }
  .box{
    width:136px;height:136px;
    background:rgba(9,9,11,0.95);
    border:1px solid rgba(255,255,255,0.08);
    border-radius:16px;
    display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:6px;
    box-shadow:0 24px 64px rgba(0,0,0,0.7),inset 0 1px 0 rgba(255,255,255,0.04);
    animation:ei .15s ease;
  }
  @keyframes ei{from{opacity:0;transform:scale(.88)}to{opacity:1;transform:scale(1)}}
  .n{
    font-size:66px;font-weight:700;line-height:1;
    color:#fff;letter-spacing:-3px;
    animation:pop .4s cubic-bezier(.22,1,.36,1);
  }
  @keyframes pop{from{transform:scale(1.22);opacity:.5}to{transform:scale(1);opacity:1}}
  .sub{
    font-size:9px;font-weight:400;
    color:rgba(255,255,255,0.25);
    letter-spacing:.2em;text-transform:uppercase;
  }
</style>
</head><body>
  <div class="box">
    <div class="n" id="n">${seconds}</div>
    <div class="sub">starting</div>
  </div>
  <script>
    let r=${seconds};
    const el=document.getElementById('n');
    const iv=setInterval(()=>{
      r-=1;
      if(r<=0){clearInterval(iv);window.close();return;}
      el.style.animation='none';
      void el.offsetHeight;
      el.style.animation='pop .4s cubic-bezier(.22,1,.36,1)';
      el.textContent=String(r);
    },1000);
  </script>
</body></html>`;

    overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    overlay.on('closed', () => resolve());
  });
}
