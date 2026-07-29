export const filmstripVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const filmstripFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uImageSize;
  uniform vec2 uPlaneSize;
  uniform float uBrightness;
  uniform float uSaturation;

  varying vec2 vUv;

  vec2 coverUv(vec2 uv, vec2 imageSize, vec2 planeSize) {
    float imageAspect = imageSize.x / max(imageSize.y, 1.0);
    float planeAspect = planeSize.x / max(planeSize.y, 1.0);
    vec2 crop = vec2(
      min(planeAspect / imageAspect, 1.0),
      min(imageAspect / planeAspect, 1.0)
    );

    return uv * crop + (1.0 - crop) * 0.5;
  }

  void main() {
    vec2 uv = coverUv(vUv, uImageSize, uPlaneSize);
    vec4 source = texture2D(uTexture, uv);
    float luminance = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 grayscale = vec3(luminance);
    vec3 color = mix(grayscale, source.rgb, uSaturation) * uBrightness;
    gl_FragColor = vec4(color, source.a);
    #include <colorspace_fragment>
  }
`;
