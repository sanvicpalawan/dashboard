/**
 * Palawan Collective brand assets.
 *
 * The turtle mark and lockup are white-on-transparent, designed for the dark
 * surfaces this workspace uses (#0b0c10). Replace the files in public/brand to
 * re-skin the workspace, or set a logo URL in Admin -> Settings -> Branding.
 */
export const BRAND_MARK_SRC = "/brand/palawan-mark-256.png";
export const BRAND_LOCKUP_SRC = "/brand/palawan-lockup.png";
export const BRAND_NAME = "Palawan Collective";
export const BRAND_CO_BRAND = "Command Center";
export const BRAND_LINE = "merQato.digital";

export function BrandLogo({ size = 32, src, label = `${BRAND_NAME} mark` }: {
  size?: number;
  src?: string | null;
  label?: string;
}) {
  return (
    <span className="brand-mark brand-mark-logo" style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src || BRAND_MARK_SRC} alt={label} width={size} height={size} />
    </span>
  );
}
