import importlib.util
import io
import unittest
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

spec = importlib.util.spec_from_file_location('browser_frameworks', Path(
    __file__).resolve().parents[1] / 'scripts/browser-frameworks.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def png(background, foreground=None):
    image = Image.new('RGBA', (20, 20), background)
    if foreground:
        for x in range(5):
            for y in range(5):
                image.putpixel((x, y), foreground)
    output = io.BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()


class FrameworkSmokeTests(unittest.TestCase):
    def test_screenshot_requires_visible_content(self):
        self.assertEqual(module.image_stats(
            png((0, 0, 0, 0)))['opaquePixels'], 0)
        self.assertEqual(module.image_stats(
            png((255, 255, 255, 255)))['contentPixels'], 0)
        self.assertEqual(module.image_stats(
            png((255, 255, 255, 255), (0, 0, 0, 255)))['contentPixels'], 25)
        self.assertEqual(module.image_stats(
            png((0, 0, 0, 0), (0, 0, 0, 255)))['contentPixels'], 25)

    def test_only_missing_favicon_console_error_is_ignored(self):
        def message(url, text, kind='error'):
            return SimpleNamespace(type=kind, text=text, location={'url': url})
        missing = 'Failed to load resource: the server responded with a status of 404 (Not Found)'
        self.assertIsNone(module.console_error(message('http://localhost/favicon.ico', missing)))
        self.assertIn('skeleton.ir.json', module.console_error(message('http://localhost/skeleton.ir.json', missing)))
        self.assertIn('500', module.console_error(message('http://localhost/favicon.ico', 'Failed to load resource: 500')))
        self.assertIn('boom', module.console_error(message('', 'boom')))

    def test_scene_requires_successful_ir_and_all_texture_pages(self):
        base = 'http://localhost/assets/scene/manifest.json'
        manifest = SimpleNamespace(ok=True, json=lambda: {
                                   'ir': 'skeleton.ir.json', 'pages': [{'url': 'a.png'}, {'url': 'b.png'}]})
        good = SimpleNamespace(ok=True)
        responses = {base: manifest, 'http://localhost/assets/scene/skeleton.ir.json': good,
                     'http://localhost/assets/scene/a.png': good}
        self.assertEqual(len(module.scene_responses(responses, base)), 1)
        responses['http://localhost/assets/scene/b.png'] = SimpleNamespace(
            ok=False, status=404)
        self.assertIn('HTTP 404', module.scene_responses(responses, base)[0])
        responses['http://localhost/assets/scene/b.png'] = good
        self.assertEqual(module.scene_responses(responses, base), [])
        self.assertEqual(module.scene_responses(
            {}, base), ['manifest not requested'])


if __name__ == '__main__':
    unittest.main()
