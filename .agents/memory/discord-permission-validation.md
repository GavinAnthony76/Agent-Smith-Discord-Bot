---
name: Discord channel permission restrictions
description: Discord's administrator-only restriction on Manage Roles in channel-creation overwrites.
---

Do not include Manage Roles in the bot's channel-creation overwrite. Keep that required permission on the bot's guild role, without granting Administrator.

**Why:** Discord's Create Guild Channel API permits setting Manage Roles in channel overwrites only for guild administrators. A nonadministrator bot can have all advertised effective permissions and still receive Missing Permissions when its own overwrite includes this bit. Owner-installed explicit Manage Permissions on an existing channel can permit edits there, but does not fix new channel creation.

**How to apply:** Separate required guild permissions from channel-overwrite permissions. Preserve owner-configured Manage Permissions grants on the trusted bot when auditing existing channels, but never excuse unexpected grants to other principals. Confirm actual writes and the live audit before declaring setup complete.

Reference: https://docs.discord.com/developers/resources/guild#create-guild-channel