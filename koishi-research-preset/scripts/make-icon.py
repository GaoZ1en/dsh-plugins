"""Render the bundle's original integral/orbit mark; requires Pillow only."""
from pathlib import Path
import math
from PIL import Image, ImageDraw

S = 4
image = Image.new('RGBA', (64*S, 64*S), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((2*S, 2*S, 62*S, 62*S), radius=15*S, fill=(37, 35, 60, 255))
# Integral curve: a cubic Bezier, authored for this bundle.
p0, p1, p2, p3 = (43, 12), (18, -1), (47, 66), (21, 51)
points = []
for i in range(101):
    t = i/100
    x = (1-t)**3*p0[0] + 3*(1-t)**2*t*p1[0] + 3*(1-t)*t*t*p2[0] + t**3*p3[0]
    y = (1-t)**3*p0[1] + 3*(1-t)**2*t*p1[1] + 3*(1-t)*t*t*p2[1] + t**3*p3[1]
    points.append((round(x*S), round(y*S)))
draw.line(points, fill=(188, 171, 244, 255), width=5*S)
for x, y in points:
    r = 2.5*S
    draw.ellipse((x-r, y-r, x+r, y+r), fill=(188, 171, 244, 255))
for x, y in [p0, p3]:
    draw.ellipse(((x-2.5)*S, (y-2.5)*S, (x+2.5)*S, (y+2.5)*S), fill=(188, 171, 244, 255))
draw.ellipse((11*S, 25*S, 19*S, 33*S), fill=(95, 194, 227, 255))
draw.line((42*S, 35*S, 51*S, 35*S), fill=(95, 194, 227, 255), width=2*S)
draw.line((42*S, 41*S, 51*S, 41*S), fill=(95, 194, 227, 255), width=2*S)
image.save(Path(__file__).resolve().parents[1] / 'icon.png')
