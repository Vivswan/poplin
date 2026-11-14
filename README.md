# Poplin

Agents publish static sites to your own Cloudflare account: private by default, shareable by secret link, or public.

```text
poplin ./report   ->   https://page-report.example.com
```

| State                 | Who can open it             |
| --------------------- | --------------------------- |
| private (the default) | only you, after one login   |
| unlisted              | anyone with the secret link |
| public                | everyone                    |

**Status:** in development, not released. Nothing here is installable yet.

## Not yet

| Planned             | Issue                                            |
| ------------------- | ------------------------------------------------ |
| Markdown publishing | [#1](https://github.com/Vivswan/poplin/issues/1) |
| Self-hosting        | [#2](https://github.com/Vivswan/poplin/issues/2) |
| Your own S3 bucket  | [#3](https://github.com/Vivswan/poplin/issues/3) |
