// Framework-independent viewer core. This entry never imports web-ifc or the
// IFC worker; hosts that need the real IFC path import `model-viewer/ifc`.
export * from "./viewer-types";
export * from "./object-ref";
export * from "./delivery-model";
export { createDeliveryViewer, type DeliveryViewerOptions, type ModelFileUrlResolver, type RendererFactory } from "./delivery-controller";
export {
  GeometryLoadError,
  type GeometryLoadSink,
  type GeometryLoader,
} from "./geometry-loader";