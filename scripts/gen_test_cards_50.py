import json

cards = []
for i in range(1, 51):
    cards.append({
        "question": f"React Draft Test Q{i}: Explain concept #{i}.",
        "explanation": f"Test explanation for card {i}. Keep it concise.",
        "difficulty": 1 if i <= 10 else 2 if i <= 20 else 3,
        "codeLanguage": "tsx" if i % 2 == 0 else "javascript",
        "codeSnippet": f"// card {i}\nconsole.log({i});" if i % 3 == 0 else "",
        "realWorldUsage": f"- Usage note for card {i}\n- Pitfall to avoid\n- Key takeaway",
        # 可选：revision（默认 1）
        "revision": 1
    })

with open("cards_50.json", "w", encoding="utf-8") as f:
    json.dump(cards, f, ensure_ascii=False, indent=2)

print("✅ wrote cards_50.json with", len(cards), "cards")