"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RefinementChatPanel } from "@/components/refinement-chat-panel";
import type { GenerationContextV1 } from "@/lib/generation-context";
import type { PlatformId } from "@/lib/platforms";
import type { RefinementKind } from "@/lib/refinement-steps";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: RefinementKind;
  platformIds: PlatformId[];
  inputSummary: string;
  onConfirm: (ctx: GenerationContextV1) => void;
};

export function RefinementChatDialog({
  open,
  onOpenChange,
  kind,
  platformIds,
  inputSummary,
  onConfirm,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden border-[#E8E4F8] bg-white p-0 sm:max-w-lg dark:border-white/10 dark:bg-zinc-950">
        <DialogHeader className="shrink-0 border-b border-[#E8E4F8] bg-[#FAFAFC] px-6 py-4 text-left dark:border-white/10 dark:bg-zinc-900/50">
          <DialogTitle className="text-[#0F0A1E] dark:text-white">Refinement chat</DialogTitle>
          <DialogDescription>
            A few quick questions so we can tailor this run. {inputSummary}
          </DialogDescription>
        </DialogHeader>

        <RefinementChatPanel
          active={open}
          kind={kind}
          platformIds={platformIds}
          inputSummary={inputSummary}
          variant="default"
          hideChrome
          className="max-h-none flex-1 rounded-none border-0 bg-transparent shadow-none outline-none"
          onConfirm={(ctx) => {
            onConfirm(ctx);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
