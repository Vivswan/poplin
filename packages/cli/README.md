# Poplin

Your AI agent, or you, publish a static site (a folder, or one HTML file) to your own Cloudflare account and get a link. A site is private until you make it unlisted or public.

```sh
npx poplin install cloudflare                          # once: your own install, under your domain or without one
```

```sh
npx poplin login --server https://poplin.example.com   # once on each computer
npx poplin mcp                                         # the MCP server an agent starts
```

```sh
npx poplin ./report                                    # a new site, private
npx poplin ./report --site report--k3f9x2ab71qz        # the same site, new content
npx poplin set report--k3f9x2ab71qz --unlisted         # anyone who has the link
```

`https://poplin.example.com` stands for the address of your own install: under your own domain, or, without a domain, the `workers.dev` address Cloudflare gives its Worker. `npx poplin install cloudflare --dry-run` lists what an install would make and changes nothing. The [repository](https://github.com/Vivswan/poplin#readme) has every step, and lists every command.
