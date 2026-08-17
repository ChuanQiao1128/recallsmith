// Type shims for static image imports (PNG/JPG/JPEG/GIF/WEBP/SVG).
// Metro/Expo resolves these to numeric ImageSourcePropType handles at runtime.

declare module '*.png' {
  const value: number;
  export default value;
}

declare module '*.jpg' {
  const value: number;
  export default value;
}

declare module '*.jpeg' {
  const value: number;
  export default value;
}

declare module '*.gif' {
  const value: number;
  export default value;
}

declare module '*.webp' {
  const value: number;
  export default value;
}

declare module '*.svg' {
  const value: number;
  export default value;
}
