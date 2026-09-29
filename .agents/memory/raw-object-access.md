---
name: Raw object access policy
description: How the public-object endpoint interacts with stored object ACL metadata.
---

# Raw object access policy

Objects found in a configured public search path remain publicly readable when
they have no ACL metadata, preserving compatibility with legacy public assets.
When ACL metadata exists, the raw-object endpoint must enforce it using the
authenticated user if present. In particular, explicit private policies must
not be bypassed by a public-object URL; use the authorized domain download route
when its access rules are broader than the stored-object owner's permissions.

**Why:** the public search path is an intentional public namespace, but private
attachments may still resolve there if storage paths overlap. Stored ACLs must
remain authoritative without breaking older public objects that predate ACL
metadata.

**How to apply:** when changing raw object serving or storage path behavior,
retain public access for no-ACL legacy objects and evaluate any existing object
policy before streaming bytes. Keep domain-specific download authorization
separate from raw object authorization.