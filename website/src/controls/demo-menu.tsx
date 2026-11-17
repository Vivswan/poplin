import { Menu, MenuContent, MenuLinkItem, MenuTrigger } from "../ui/menu.tsx";

interface Props {
  /** The demo on each kind of install, in the order the menu lists them. */
  links: readonly { label: string; href: string }[];
}

/** The header's Demo entry when the demo runs on both kinds of install: a button whose menu links to each. */
export function DemoMenu({ links }: Props): React.ReactElement {
  return (
    <Menu>
      <MenuTrigger>Demo</MenuTrigger>
      <MenuContent>
        {links.map((link) => (
          <MenuLinkItem key={link.label} href={link.href}>
            {link.label}
          </MenuLinkItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
