const minimumChangedPixelCount = 64;
const minimumChangedPixelRatio = 0.005;

export function hasVisibleCanvasContent(png) {
  const [backgroundRed, backgroundGreen, backgroundBlue, backgroundAlpha] = png.data;
  const pixelCount = png.width * png.height;
  const requiredChangedPixelCount = Math.max(
    minimumChangedPixelCount,
    Math.ceil(pixelCount * minimumChangedPixelRatio),
  );
  let changedPixelCount = 0;

  for (let index = 0; index < png.data.length; index += 4) {
    const red = png.data[index];
    const green = png.data[index + 1];
    const blue = png.data[index + 2];
    const alpha = png.data[index + 3];
    const changed = alpha !== backgroundAlpha
      || Math.abs(red - backgroundRed) > 8
      || Math.abs(green - backgroundGreen) > 8
      || Math.abs(blue - backgroundBlue) > 8;

    if (changed) {
      changedPixelCount += 1;

      if (changedPixelCount >= requiredChangedPixelCount) {
        return true;
      }
    }
  }

  return false;
}
