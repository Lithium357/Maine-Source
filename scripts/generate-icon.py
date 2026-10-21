"""Generate the app's code-native pine icon. Requires Pillow for build preparation only."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
assets = root / 'assets'
assets.mkdir(exist_ok=True)
image = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((4, 4, 252, 252), radius=50, fill='#173D3C')
draw.polygon([(128, 32), (192, 115), (158, 115), (214, 181), (143, 181), (143, 226), (113, 226), (113, 181), (42, 181), (98, 115), (64, 115)], fill='#B4D4B2')
image.save(assets / 'icon.png')
image.save(assets / 'icon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
