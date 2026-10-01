import React from 'react';
import { StyleSheet, View } from 'react-native';

import CodeBlock from '../../../components/CodeBlock';
import type { QuestionCode } from '../../../content/questionCode';
import { friendlyCodeLanguage } from '../components/CardAnswerSections';
import { normalizeCodeLanguage } from './reviewContentHelpers';

export const QUESTION_CODE_TEST_ID = 'question-code';

// The code a question carries in its fenced block (splitQuestionCode), rendered
// with the same CodeBlock, tokenizer hint and language caption the answer-side
// CODING SAMPLE uses, so the question code and the answer code look alike. The
// CodeBlock's own horizontal ScrollView keeps long lines on one line.
export function QuestionCodeBlock(props: { code: QuestionCode; testID?: string }) {
  const { code, testID = QUESTION_CODE_TEST_ID } = props;
  return (
    <View style={styles.container} testID={testID}>
      <CodeBlock
        code={code.source}
        language={normalizeCodeLanguage(code.language)}
        label={friendlyCodeLanguage(code.language)}
      />
    </View>
  );
}

export default QuestionCodeBlock;

const styles = StyleSheet.create({
  container: {
    marginTop: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
