// Canonical list of Spanish vocational-training "familias profesionales"
// (INCUAL / Ministerio de Educación y FP). Used to populate the professional
// family selector in Configuración → Apariencia. The selected value is stored
// as a plain string, so this list only drives the dropdown options.
export const PROFESSIONAL_FAMILIES: readonly string[] = [
  "Actividades Físicas y Deportivas",
  "Administración y Gestión",
  "Agraria",
  "Artes Gráficas",
  "Artes y Artesanías",
  "Comercio y Marketing",
  "Edificación y Obra Civil",
  "Electricidad y Electrónica",
  "Energía y Agua",
  "Fabricación Mecánica",
  "Hostelería y Turismo",
  "Imagen Personal",
  "Imagen y Sonido",
  "Industrias Alimentarias",
  "Industrias Extractivas",
  "Informática y Comunicaciones",
  "Instalación y Mantenimiento",
  "Madera, Mueble y Corcho",
  "Marítimo-Pesquera",
  "Química",
  "Sanidad",
  "Seguridad y Medio Ambiente",
  "Servicios Socioculturales y a la Comunidad",
  "Textil, Confección y Piel",
  "Transporte y Mantenimiento de Vehículos",
  "Vidrio y Cerámica",
] as const;
