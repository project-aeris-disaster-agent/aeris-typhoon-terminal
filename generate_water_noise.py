#!/usr/bin/env python3
"""Generate a tileable water-noise texture for flood hazard visualization."""

import numpy as np
from PIL import Image

# Create a 256x256 tileable Perlin-like noise using octave blending
size = 256

# Generate layered noise for organic look
noise = np.zeros((size, size))

# Create simple tileable noise octaves
for octave in range(4):
    freq = 2 ** octave
    amp = 1 / (2 ** octave)
    
    # Create seamless noise by wrapping coordinates
    x = np.linspace(0, freq, size, endpoint=False)
    y = np.linspace(0, freq, size, endpoint=False)
    xx, yy = np.meshgrid(x, y)
    
    # Simple sine-based seamless noise
    octave_noise = (
        np.sin(xx * np.pi) * np.sin(yy * np.pi) * 
        np.sin(xx * np.pi * 2) * np.sin(yy * np.pi * 2)
    )
    noise += octave_noise * amp

# Normalize to [0, 1]
noise = (noise - noise.min()) / (noise.max() - noise.min())

# Boost contrast slightly for softer but defined pattern
noise = np.power(noise, 0.9)

# Convert to 8-bit grayscale
noise_8bit = (noise * 255).astype(np.uint8)

# Create PIL image and save
img = Image.fromarray(noise_8bit, mode='L')
img.save('public/textures/water-noise.png', 'PNG')

print(f"Generated water-noise.png ({size}x{size}, grayscale)")
print(f"File size: {img.nbytes / 1024:.1f} KB")
