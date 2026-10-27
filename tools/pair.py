# Pair each <name>-d.png with <name>-m.png side by side at the same height, for quick review.
import sys, os
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
names = sorted({f[:-6] for f in os.listdir(src) if f.endswith('-d.png')})
H = 900
for n in names:
    d = Image.open(os.path.join(src, n + '-d.png')).convert('RGB')
    m = Image.open(os.path.join(src, n + '-m.png')).convert('RGB')
    d = d.resize((round(d.width * H / d.height), H))
    m = m.resize((round(m.width * H / m.height), H))
    out = Image.new('RGB', (d.width + 16 + m.width, H), (20, 20, 20))
    out.paste(d, (0, 0)); out.paste(m, (d.width + 16, 0))
    out.save(os.path.join(dst, n + '.png'))
print(len(names), 'pairs')
