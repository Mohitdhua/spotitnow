declare module 'imagetracerjs' {
  export interface ImageTracerPaletteColor {
    r: number;
    g: number;
    b: number;
    a: number;
  }

  export interface ImageTracerOptions {
    corsenabled?: boolean;
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    rightangleenhance?: boolean;
    colorsampling?: 0 | 1 | 2;
    numberofcolors?: number;
    mincolorratio?: number;
    colorquantcycles?: number;
    layering?: 0 | 1;
    strokewidth?: number;
    linefilter?: boolean;
    scale?: number;
    roundcoords?: number;
    viewbox?: boolean;
    desc?: boolean;
    lcpr?: number;
    qcpr?: number;
    blurradius?: number;
    blurdelta?: number;
    pal?: ImageTracerPaletteColor[];
  }

  export interface ImageTracerApi {
    versionnumber: string;
    optionpresets: Record<string, Partial<ImageTracerOptions>>;
    imagedataToSVG: (imgd: ImageData, options?: Partial<ImageTracerOptions> | string) => string;
    imagedataToTracedata: (imgd: ImageData, options?: Partial<ImageTracerOptions> | string) => unknown;
  }

  const ImageTracer: ImageTracerApi;
  export default ImageTracer;
}
