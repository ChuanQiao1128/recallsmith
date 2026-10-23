function rgb(hex: string): number[] {
  const value = hex.slice(1);
  const full = value.length === 3 ? [...value].map((digit) => digit + digit).join('') : value;
  if (!/^[\da-f]{6}$/i.test(full)) throw new Error(`Unsupported contrast color: ${hex}`);
  return full.match(/../g)!.map((channel) => parseInt(channel, 16));
}

export function composite(foreground: string, background: string, opacity = 1): string {
  const backdrop = rgb(background);
  return '#' + rgb(foreground).map((channel, index) =>
    Math.round(channel * opacity + backdrop[index] * (1 - opacity)).toString(16).padStart(2, '0'),
  ).join('');
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = rgb(hex).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function flattenStyle(style: any): Record<string, any> {
  return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flattenStyle)) : style ?? {};
}
