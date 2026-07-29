import { forwardRef } from "react";
import type { CSSProperties, ImgHTMLAttributes } from "react";

interface NextImageMockProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "alt" | "src"
> {
  alt: string;
  fill?: boolean;
  src: string | { src: string };
  unoptimized?: boolean;
}

const NextImageMock = forwardRef<HTMLImageElement, NextImageMockProps>(
  function NextImageMock({ alt, fill, src, style, unoptimized, ...imageProps }, ref) {
    void unoptimized;
    const fillStyle: CSSProperties | undefined = fill
      ? {
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          ...style,
        }
      : style;

    return (
      // This Vite-only test double intentionally reduces next/image to its DOM output.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        {...imageProps}
        alt={alt}
        ref={ref}
        src={typeof src === "string" ? src : src.src}
        style={fillStyle}
      />
    );
  },
);

export default NextImageMock;
