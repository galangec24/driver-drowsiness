/**
 * Page background: the calm base gradient, slow drifting light (like an aurora: three soft glows
 * on long, out-of-step paths so the motion never visibly loops), a faint 3D road with moving lane
 * lines at the bottom, and fine grain that keeps the gradients from banding.
 * Only transforms are animated (GPU), and everything stands still with "reduce motion".
 */
export function AnimatedBackground({ road = true }: { road?: boolean }) {
  return (
    <div aria-hidden="true" className="bg-scene" data-testid="animated-background">
      <div className="mesh-bg" />
      <div className="aurora aurora-1" />
      <div className="aurora aurora-2" />
      <div className="aurora aurora-3" />
      {road && (
        <div className="bg-road">
          <div className="bg-road-plane">
            <div className="bg-road-lines" />
          </div>
        </div>
      )}
      <div className="bg-grain" />
    </div>
  );
}
