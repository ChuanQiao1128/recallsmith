"""Existing bounded English retrieval query validation, shared without entrypoints."""
import re

def validate_goal(goal):
    if (not isinstance(goal, str) or not 1 <= len(goal) <= 800 or
            not re.fullmatch(r'[\x20-\x7e]+', goal) or not re.search(r'[A-Za-z]{3}', goal) or
            re.search(r'(?i)([a-z][a-z0-9+.-]*://|www\.|[a-z0-9-]+\.[a-z]{2,}\b|answer\s*[:=]|correct\s+answer|[\\]|\.\./)', goal)):
        raise ValueError('A bounded English learning goal without URLs or answer fields is required')

