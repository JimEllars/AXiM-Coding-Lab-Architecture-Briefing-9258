import json

def complete():
    print(json.dumps({
        "screenshot": "/home/jules/verification/screenshots/verification.png",
        "videos": ["/home/jules/verification/videos/9349a4ec21f56277aae1969f98bc6673.webm"]
    }))

complete()
