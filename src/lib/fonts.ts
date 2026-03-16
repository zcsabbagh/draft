export interface FontOption {
  name: string;
  family: string;
  category: 'Serif' | 'Sans' | 'Mono';
  googleId?: string; // undefined means system font, no Google Fonts load needed
}

export const FONT_OPTIONS: FontOption[] = [
  // Serif
  { name: 'Georgia', family: "'Georgia', 'Times New Roman', serif", category: 'Serif' },
  { name: 'Merriweather', family: "'Merriweather', Georgia, serif", category: 'Serif', googleId: 'Merriweather' },
  { name: 'Lora', family: "'Lora', Georgia, serif", category: 'Serif', googleId: 'Lora' },
  { name: 'Playfair Display', family: "'Playfair Display', Georgia, serif", category: 'Serif', googleId: 'Playfair+Display' },
  { name: 'Source Serif Pro', family: "'Source Serif Pro', Georgia, serif", category: 'Serif', googleId: 'Source+Serif+Pro' },
  { name: 'Crimson Text', family: "'Crimson Text', Georgia, serif", category: 'Serif', googleId: 'Crimson+Text' },
  { name: 'EB Garamond', family: "'EB Garamond', Georgia, serif", category: 'Serif', googleId: 'EB+Garamond' },

  // Sans-serif
  { name: 'Inter', family: "'Inter', system-ui, sans-serif", category: 'Sans', googleId: 'Inter' },
  { name: 'Open Sans', family: "'Open Sans', system-ui, sans-serif", category: 'Sans', googleId: 'Open+Sans' },
  { name: 'Roboto', family: "'Roboto', system-ui, sans-serif", category: 'Sans', googleId: 'Roboto' },
  { name: 'Lato', family: "'Lato', system-ui, sans-serif", category: 'Sans', googleId: 'Lato' },
  { name: 'Nunito', family: "'Nunito', system-ui, sans-serif", category: 'Sans', googleId: 'Nunito' },
  { name: 'Work Sans', family: "'Work Sans', system-ui, sans-serif", category: 'Sans', googleId: 'Work+Sans' },
  { name: 'DM Sans', family: "'DM Sans', system-ui, sans-serif", category: 'Sans', googleId: 'DM+Sans' },

  // Monospace
  { name: 'JetBrains Mono', family: "'JetBrains Mono', monospace", category: 'Mono', googleId: 'JetBrains+Mono' },
  { name: 'Fira Code', family: "'Fira Code', monospace", category: 'Mono', googleId: 'Fira+Code' },
  { name: 'Source Code Pro', family: "'Source Code Pro', monospace", category: 'Mono', googleId: 'Source+Code+Pro' },
];

const loadedFonts = new Set<string>();

export function loadGoogleFont(font: FontOption): void {
  if (!font.googleId || loadedFonts.has(font.googleId)) return;

  const linkId = `google-font-${font.googleId}`;
  if (document.getElementById(linkId)) {
    loadedFonts.add(font.googleId);
    return;
  }

  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${font.googleId}:wght@400;700&display=swap`;
  document.head.appendChild(link);
  loadedFonts.add(font.googleId);
}

export function getFontByName(name: string): FontOption {
  return FONT_OPTIONS.find((f) => f.name === name) || FONT_OPTIONS[0];
}
