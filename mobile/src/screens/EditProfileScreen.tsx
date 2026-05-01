import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'EditProfile'>;

export function EditProfileScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Edit profile"
      title="Nickname, avatar, and identity preferences"
      body="Keep profile editing small, readable, and obviously safe. This is where identity changes belong, not where study logic gets redefined."
      chips={['Identity', 'Safe edits']}
      sections={[
        {
          title: 'Profile fields',
          items: [
            { title: 'Nickname', subtitle: 'Learner #local' },
            { title: 'Avatar', subtitle: 'Parchment sigil' },
            { title: 'Audience', subtitle: 'Both' },
          ],
        },
        {
          title: 'What changes here',
          body: 'Identity and display preferences change here. Scheduling, streak rules, and due-review behavior stay elsewhere so the page remains easy to trust.',
        },
      ]}
      primaryLabel="Back to profile"
      onPrimary={() => navigation.navigate('Profile')}
    />
  );
}

export default EditProfileScreen;