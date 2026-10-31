#!/usr/bin/env python3
"""Production React, Next and vanilla browser smoke test."""
import io
import json
import os
import shutil
import subprocess
import time
import urllib.request
from collections import Counter
from pathlib import Path
from urllib.parse import urljoin, urlparse

from PIL import Image
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
artifacts = root / 'framework-browser-artifacts'
apps = [
    ('react', root / 'examples/react', ['node', 'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4175'], 4175),
    ('nextjs', root / 'examples/nextjs', ['node', 'node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '4176'], 4176),
    ('vanilla', root / 'examples/vanilla-web', ['node', 'serve.mjs'], 4177),
]


def image_stats(png):
    """Check the composited screenshot, not WebGL's transient drawing buffer."""
    with Image.open(io.BytesIO(png)) as image:
        pixels = list(image.convert('RGBA').getdata())
    opaque = [p for p in pixels if p[3] > 0]
    if not opaque:
        return {'opaquePixels': 0, 'contentPixels': 0}
    background = Counter(pixels).most_common(1)[0][0]
    content = sum(1 for p in opaque if sum(abs(p[i] - background[i]) for i in range(4)) > 24)
    return {'opaquePixels': len(opaque), 'contentPixels': content}


def scene_responses(responses, manifest_url):
    """Return missing/failed scene requests, including every manifest texture page."""
    response = responses.get(manifest_url)
    if response is None:
        return ['manifest not requested']
    if not response.ok:
        return [f'manifest HTTP {response.status}']
    manifest = response.json()
    required = [urljoin(manifest_url, manifest['ir'])]
    required.extend(urljoin(manifest_url, page['url']) for page in manifest['pages'])
    if len(required) < 2:
        return ['manifest has no texture pages']
    failures = []
    for url in required:
        asset = responses.get(url)
        if asset is None:
            failures.append(f'not requested: {url}')
        elif not asset.ok:
            failures.append(f'HTTP {asset.status}: {url}')
    return failures


def console_error(message):
    """Keep application errors; ignore only the browser's missing default favicon."""
    if message.type != 'error':
        return None
    location = message.location.get('url', '')
    if (urlparse(location).path == '/favicon.ico' and
            message.text.startswith('Failed to load resource:') and
            '404' in message.text):
        return None
    return f'{location}: {message.text}' if location else message.text


def check_page(browser, name, port):
    page = browser.new_page(viewport={'width': 960, 'height': 720})
    responses = {}
    errors = []
    stats = None
    png = None
    page.on('response', lambda response: responses.__setitem__(response.url, response))
    page.on('pageerror', lambda error: errors.append(str(error)))
    def on_console(message):
        error = console_error(message)
        if error:
            errors.append(error)
    page.on('console', on_console)
    page.on('requestfailed', lambda request: errors.append(f'{request.url}: {request.failure}'))
    manifest_url = f'http://127.0.0.1:{port}/assets/scene/manifest.json'
    try:
        page.goto(f'http://127.0.0.1:{port}/', wait_until='networkidle', timeout=25000)
        if name == 'nextjs':
            page.get_by_text('Independent Skeleton Player').wait_for(timeout=10000)
        canvas = page.locator('canvas').first
        canvas.wait_for(state='visible', timeout=10000)
        page.wait_for_function("() => !!document.querySelector('canvas').getContext('webgl2')", timeout=10000)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            failures = scene_responses(responses, manifest_url)
            if not failures:
                png = canvas.screenshot(omit_background=True, timeout=5000)
                stats = image_stats(png)
                if stats['opaquePixels'] > 0 and stats['contentPixels'] >= 10:
                    break
            page.wait_for_timeout(200)
        if errors or failures or not stats or stats['opaquePixels'] == 0 or stats['contentPixels'] < 10:
            raise RuntimeError(f'{name}: errors={errors}, scene={failures}, screenshot={stats}')
        return {'framework': name, 'status': 'PASS', **stats}
    except Exception as error:
        artifacts.mkdir(exist_ok=True)
        if png is None:
            try:
                png = page.locator('canvas').first.screenshot(omit_background=True, timeout=2000)
            except Exception:
                pass
        if png is not None:
            (artifacts / f'{name}-canvas.png').write_bytes(png)
        try:
            page.screenshot(path=str(artifacts / f'{name}-page.png'), full_page=True)
        except Exception:
            pass
        diagnostic = {'framework': name, 'error': str(error), 'browserErrors': errors,
                      'responses': [{'url': r.url, 'status': r.status} for r in responses.values()],
                      'screenshot': stats}
        (artifacts / f'{name}-diagnostics.json').write_text(json.dumps(diagnostic, indent=2), encoding='utf-8')
        raise
    finally:
        page.close()


def main():
    processes = []
    try:
        for name, cwd, args, port in apps:
            environment = os.environ.copy()
            environment['PORT'] = str(port)
            proc = subprocess.Popen(args, cwd=cwd, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            processes.append(proc)
            ready = False
            for _ in range(50):
                if proc.poll() is not None:
                    break
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=1) as resp:
                        ready = resp.status == 200
                        if ready:
                            break
                except Exception:
                    pass
                time.sleep(.2)
            if not ready:
                raise RuntimeError(f'{name} production HTTP server could not start')
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=shutil.which('chromium'), headless=True,
                args=['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader'])
            try:
                results = [check_page(browser, name, port) for name, _, _, port in apps]
            finally:
                browser.close()
        print(json.dumps({'result': 'PASS', 'tests': results}))
    except Exception as error:
        artifacts.mkdir(exist_ok=True)
        (artifacts / 'failure.json').write_text(json.dumps({'error': str(error)}, indent=2), encoding='utf-8')
        raise
    finally:
        for proc in processes:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == '__main__':
    main()
