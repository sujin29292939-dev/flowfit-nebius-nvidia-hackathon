import { cn } from "@/lib/utils";

type FlowFitLogoMarkProps = {
  alt?: string;
  className?: string;
  imageClassName?: string;
};

export function FlowFitLogoMark({ alt = "FlowFit", className, imageClassName }: FlowFitLogoMarkProps) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center overflow-hidden bg-white", className)}>
      <img src="/flowfit-symbol.png" alt={alt} className={cn("h-full w-full object-contain", imageClassName)} />
    </span>
  );
}
