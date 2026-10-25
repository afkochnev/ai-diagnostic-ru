// Read-only W1 evidence. These files stay at the original base, never copied, moved or overwritten.
export const LEGACY_FILES = [
    {
        "path": "control-operations/callback-add-attempt.json",
        "sha256": "73dbf6d6166dcc1a2c344d6754bd935151e362a23e6e17d0e84931d0275b046b"
    },
    {
        "path": "control-operations/callback-add-confirmed.json",
        "sha256": "db888bb7c1348e0c7bb8f1cccef4ea69bd4aaa3e250583681fdbad3fedb815fc"
    },
    {
        "path": "control-operations/callback-restore-attempt.json",
        "sha256": "c77d046698e3816550c1f485461e0b0d67627a265f1d78d47ba622d6da43deb0"
    },
    {
        "path": "control-operations/callback-restore-confirmed.json",
        "sha256": "a5040e8744af8f8d9fbf0363afe54ce5ad3fffa009aba05214edf1616b8799d0"
    },
    {
        "path": "control-operations/deploy-close-creation-attempt.json",
        "sha256": "4035a1a80897989a2f83753367309b1c220d788a01964f011fa5c1a57dbb50a1"
    },
    {
        "path": "control-operations/deploy-close-creation-confirmed.json",
        "sha256": "370865b25257e36ad30166057962d749a06dabf734291078e8f85246a2bd9508"
    },
    {
        "path": "control-operations/deploy-close-creation-live.json",
        "sha256": "ac1f1c6eb43fdbf5eef7094d215c9c71b39bbda73228a79ed408d696d3d268cd"
    },
    {
        "path": "control-operations/deploy-close-invitations-attempt.json",
        "sha256": "e3590eee3bd002ea0a1db14be08ecd0448dd1f016d53ba892add2e84c64098b4"
    },
    {
        "path": "control-operations/deploy-close-invitations-confirmed.json",
        "sha256": "b0feee7d66d21cbd301c88dc9c48b466fc6719af089dc37c282dba93a8b5a645"
    },
    {
        "path": "control-operations/deploy-close-invitations-live.json",
        "sha256": "4dce9db055f5c4c2878e2830973e98015e32311d94ee6b0bc407d3497fe8004d"
    },
    {
        "path": "control-operations/deploy-enable-attempt.json",
        "sha256": "5796bab50afde13f3e880246c31e68ede4ef19ebee91041b6013fe3cc8465836"
    },
    {
        "path": "control-operations/deploy-enable-confirmed.json",
        "sha256": "cc8cc8ecdc704dac5ac815cdcf48e21b18d116d0c8262546028e0b883f4bd97f"
    },
    {
        "path": "control-operations/deploy-enable-live.json",
        "sha256": "5571ab31aaf19358378959d309c02cda4bc9a861b997cbfa9709c06866b15bea"
    },
    {
        "path": "control-operations/deploy-restore-attempt.json",
        "sha256": "bf6a3aca8b2cfc61dd5912001a802380c75bb625424e8950c25e2d94e9a4f277"
    },
    {
        "path": "control-operations/deploy-restore-confirmed.json",
        "sha256": "1a9d5bab81361464f8e99ba84527d6ac470a5365e980b56092af2161124dea2d"
    },
    {
        "path": "control-operations/deploy-restore-live.json",
        "sha256": "c2931e08694e0f23bebbe57fd974f69f7f571e9fc2a27ac5877f98ead18c50f9"
    },
    {
        "path": "control-operations/env-close-creation-attempt.json",
        "sha256": "74f0e445162e3f0db55329925fb5c51f59b6e94cd9a055a34f6a1efe2e4a3136"
    },
    {
        "path": "control-operations/env-close-creation-confirmed.json",
        "sha256": "b4ba9102525955ee0fc6d448e593204b9af9dc88e2e7bc9615d4a133b1eb8b72"
    },
    {
        "path": "control-operations/env-close-invitations-attempt.json",
        "sha256": "1deddd84eba54f9162b8d63d44b546383d36792e840096b35dc45ba488726a59"
    },
    {
        "path": "control-operations/env-close-invitations-confirmed.json",
        "sha256": "8c878c14bcf5e166bc561e99d6aa6dc7f4f0874d29928b99c55c696d148f979e"
    },
    {
        "path": "control-operations/env-enable-attempt.json",
        "sha256": "80d06af98798e00a488079cdd2e7e4ca06ee1d7e69b8be11d2bd723760494cde"
    },
    {
        "path": "control-operations/env-enable-confirmed.json",
        "sha256": "9e8056e11933de83fdb18ff691333153dc8449ced2998fa95b255d20c7db1dad"
    },
    {
        "path": "control-operations/env-restore-attempt.json",
        "sha256": "b599b12042dc5ac78a2e2bc746f78c308d3242c809485ffb306ff259b31415bc"
    },
    {
        "path": "control-operations/env-restore-confirmed.json",
        "sha256": "abd756d304a93f7698ad25a1f5ff3199a69587ebdf78b8627014936a8f400fca"
    },
    {
        "path": "control-operations/resume-worker-attempt.json",
        "sha256": "f1a3fc011f92ae3299b12072ac57fc4c2a2ab5a7f4d4c21d3b729927233afb7d"
    },
    {
        "path": "control-operations/resume-worker-confirmed.json",
        "sha256": "6aa0b7fa940bfd35916ad660dadc86c490b39d3b497d5158d5985c8b55c9a444"
    },
    {
        "path": "control-operations/suspend-worker-attempt.json",
        "sha256": "d4002e119b552662845180d106cd795a5e92b532e5427ec419dd3d60682e20bf"
    },
    {
        "path": "control-operations/suspend-worker-confirmed.json",
        "sha256": "535b3e6d7295a5209f1cd7201311801f49e29d0293a435c0c7681b5b8de4c4d3"
    },
    {
        "path": "db-control-operations/db-close-creation-attempt.json",
        "sha256": "e11e0320cd874c6216b9b772b84be91c8027c0e6589e76079e263dc9ecea62f7"
    },
    {
        "path": "db-control-operations/db-close-creation-confirmed.json",
        "sha256": "9de25e291a04b164d0e8aeafbfbea5dfc0ec2ab1128ee40beef976abb279489e"
    },
    {
        "path": "db-control-operations/db-close-invitations-attempt.json",
        "sha256": "6ca739ee8f40905401b04756ad30c2b0972a42faa53442348efd2a5b80c8625f"
    },
    {
        "path": "db-control-operations/db-close-invitations-confirmed.json",
        "sha256": "41d08c3d254025a7435c487ec3ef436ad715f64187fd4c5141074ff7149736a7"
    },
    {
        "path": "db-control-operations/db-open-creation-attempt.json",
        "sha256": "399b00c45dad4b825e564365b81c40224582a1cebeed4a71e02cb27fb9abf7b2"
    },
    {
        "path": "db-control-operations/db-open-creation-confirmed.json",
        "sha256": "0477c672ad22c658c11a4cb25c787d3ae49d0942b83c78cdf00cd6a2f032497b"
    },
    {
        "path": "db-control-operations/db-open-invitations-attempt.json",
        "sha256": "06834cc2de5f01fa9fe34e5cc3724bee7c7b3dd57a120c023ad4b2f4ebd3c49f"
    },
    {
        "path": "db-control-operations/db-open-invitations-confirmed.json",
        "sha256": "c3472f619003c27baa1f425e5ed678c4939afee52ef5b9c11d5f0b048fcd9f5d"
    },
    {
        "path": "db-control-operations/db-stop-run-attempt.json",
        "sha256": "5efb8ba837eb9569ee14bc8d4fe50185c0a42148841ff4f70c985a6a4011585a"
    },
    {
        "path": "db-control-operations/db-stop-run-confirmed.json",
        "sha256": "bf2f0f8e4e312d2fbc8a981b94d7940e12ebb397a425084574347e8b33d6390c"
    },
    {
        "path": "db-control-operations/run-configured-attempt.json",
        "sha256": "feae7a1537f7470b504a3c57aca9e602f762337f5469c04609f57e2b031c5548"
    },
    {
        "path": "db-control-operations/run-configured-confirmed.json",
        "sha256": "08d49f6d952ea227b3ec84b9e837ac4109a36fafde2a156d43513bd58b9fb882"
    }
] as const;
