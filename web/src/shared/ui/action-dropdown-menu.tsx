import * as React from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

type DropdownMenuContentProps = React.ComponentProps<typeof DropdownMenuContent>;
type DropdownMenuItemProps = React.ComponentProps<typeof DropdownMenuItem>;

interface ActionDropdownMenuItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  shortcut?: React.ReactNode;
  disabled?: DropdownMenuItemProps["disabled"];
  variant?: "default" | "destructive";
  closeOnClick?: DropdownMenuItemProps["closeOnClick"];
  className?: string;
  onSelect?: DropdownMenuItemProps["onClick"];
  type?: "item";
}

interface ActionDropdownMenuLabel {
  key: string;
  label: React.ReactNode;
  inset?: boolean;
  className?: string;
  type: "label";
}

interface ActionDropdownMenuSeparator {
  key: string;
  className?: string;
  type: "separator";
}

type ActionDropdownMenuEntry =
  | ActionDropdownMenuItem
  | ActionDropdownMenuLabel
  | ActionDropdownMenuSeparator;

interface ActionDropdownMenuProps {
  trigger: React.ReactElement;
  items: ActionDropdownMenuEntry[];
  wrapTrigger?: (trigger: React.ReactElement) => React.ReactNode;
  align?: DropdownMenuContentProps["align"];
  alignOffset?: DropdownMenuContentProps["alignOffset"];
  side?: DropdownMenuContentProps["side"];
  sideOffset?: DropdownMenuContentProps["sideOffset"];
  contentClassName?: string;
}

interface DropdownMenuSection {
  key: string;
  label?: ActionDropdownMenuLabel;
  items: ActionDropdownMenuItem[];
}

function isSeparatorSection(
  section: DropdownMenuSection | ActionDropdownMenuSeparator
): section is ActionDropdownMenuSeparator {
  return "type" in section && section.type === "separator";
}

function buildSections(items: ActionDropdownMenuEntry[]) {
  const sections: Array<DropdownMenuSection | ActionDropdownMenuSeparator> = [];
  let currentSection: DropdownMenuSection = {
    key: "section-0",
    items: [],
  };
  let sectionIndex = 0;

  const pushCurrentSection = () => {
    if (!currentSection.label && currentSection.items.length === 0) {
      return;
    }

    sections.push(currentSection);
    sectionIndex += 1;
    currentSection = {
      key: `section-${sectionIndex}`,
      items: [],
    };
  };

  items.forEach((item) => {
    if (item.type === "separator") {
      pushCurrentSection();
      sections.push(item);
      return;
    }

    if (item.type === "label") {
      pushCurrentSection();
      currentSection = {
        key: `section-${sectionIndex}`,
        label: item,
        items: [],
      };
      return;
    }

    currentSection.items.push(item);
  });

  pushCurrentSection();

  return sections;
}

function ActionDropdownMenu({
  trigger,
  items,
  wrapTrigger,
  align = "end",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 6,
  contentClassName,
}: ActionDropdownMenuProps) {
  const triggerNode = <DropdownMenuTrigger render={trigger} />;
  const sections = buildSections(items);

  return (
    <DropdownMenu>
      {wrapTrigger ? wrapTrigger(triggerNode) : triggerNode}
      <DropdownMenuContent
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className={contentClassName}
      >
        {sections.map((section) => {
          if (isSeparatorSection(section)) {
            return <DropdownMenuSeparator key={section.key} className={section.className} />;
          }

          return (
            <DropdownMenuGroup key={section.key}>
              {section.label ? (
                <DropdownMenuLabel
                  inset={section.label.inset}
                  className={section.label.className}
                >
                  {section.label.label}
                </DropdownMenuLabel>
              ) : null}

              {section.items.map((item) => (
                <DropdownMenuItem
                  key={item.key}
                  disabled={item.disabled}
                  variant={item.variant}
                  closeOnClick={item.closeOnClick}
                  className={item.className}
                  onClick={item.onSelect}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.shortcut ? (
                    <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ActionDropdownMenu };
export type {
  ActionDropdownMenuEntry,
  ActionDropdownMenuItem,
  ActionDropdownMenuLabel,
  ActionDropdownMenuProps,
  ActionDropdownMenuSeparator,
};
