// Preserve only an initial, opaque, uniform page backdrop. Never copy text,
// images, compound paths, gradients, or other potentially sensitive artwork.
export function pageBackground(mupdf, page, bounds) {
  let accepting = true;
  let background = null;
  const stop = () => {
    accepting = false;
  };

  function coversPage(path, matrix) {
    const points = [];
    let simple = true;
    let closed = false;

    path.walk({
      moveTo(x, y) {
        points.push([x, y]);
      },
      lineTo(x, y) {
        points.push([x, y]);
      },
      curveTo() {
        simple = false;
      },
      closePath() {
        closed = true;
      },
    });

    if (points.length === 5 && points[0][0] === points[4][0] && points[0][1] === points[4][1]) {
      points.pop();
    }

    if (!simple || !closed || points.length !== 4) {
      return false;
    }

    const transformed = points.map(([x, y]) => [
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5],
    ]);

    for (let i = 0; i < 4; i++) {
      const a = transformed[i],
        b = transformed[(i + 1) % 4];

      if (Math.abs(a[0] - b[0]) > 0.01 && Math.abs(a[1] - b[1]) > 0.01) {
        return false;
      }
    }

    const xs = transformed.map((point) => point[0]),
      ys = transformed.map((point) => point[1]);

    return (
      Math.min(...xs) <= bounds[0] + 0.01 &&
      Math.min(...ys) <= bounds[1] + 0.01 &&
      Math.max(...xs) >= bounds[2] - 0.01 &&
      Math.max(...ys) >= bounds[3] - 0.01
    );
  }

  const device = new mupdf.Device({
    fillPath(path, _evenOdd, matrix, colorspace, color, alpha) {
      if (!accepting) {
        return;
      }

      const name = colorspace.getName();

      if (
        alpha !== 1 ||
        !['DeviceRGB', 'DeviceGray', 'DeviceCMYK'].includes(name) ||
        !coversPage(path, matrix)
      ) {
        stop();

        return;
      }

      background = { colorspace: name, color: [...color] };
    },
    clipPath(path, _evenOdd, matrix) {
      if (accepting && !coversPage(path, matrix)) {
        stop();
      }
    },
    beginGroup(_area, _colorspace, _isolated, _knockout, blend, alpha) {
      if (blend !== 'Normal' || alpha !== 1) {
        stop();
      }
    },
    beginMask: stop,
    beginTile: stop,
    clipStrokePath: stop,
    clipText: stop,
    clipStrokeText: stop,
    clipImageMask: stop,
    fillText: stop,
    strokeText: stop,
    strokePath: stop,
    fillShade: stop,
    fillImage: stop,
    fillImageMask: stop,
  });

  try {
    page.runPageContents(device, mupdf.Matrix.identity);
    device.close();
  } finally {
    device.destroy();
  }

  return background;
}

export function drawBackground(mupdf, device, background, width, height) {
  if (!background) {
    return;
  }

  const path = new mupdf.Path();

  try {
    path.rect(0, 0, width, height);

    device.fillPath(
      path,
      false,
      mupdf.Matrix.identity,
      mupdf.ColorSpace[background.colorspace],
      background.color,
      1,
    );
  } finally {
    path.destroy();
  }
}
