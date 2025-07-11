import React, { useState, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import get from 'lodash/get';
import ToggleSelector from 'components/RequestPane/Settings/ToggleSelector';
import { updateRequestSettings } from 'providers/ReduxStore/slices/collections';

const Settings = ({ item, collection }) => {
  const dispatch = useDispatch();

  // get the length of active params, headers, asserts and vars as well as the contents of the body, tests and script
  const getPropertyFromDraftOrRequest = (propertyKey) =>
    item.draft ? get(item, `draft.${propertyKey}`, []) : get(item, propertyKey, []);

  const settings = getPropertyFromDraftOrRequest('request.settings');

  const [urlEncoding, setUrlEncoding] = useState(settings?.encodeUrl ?? false);

  const onToggleUrlEncoding = useCallback(() => {
    const newValue = !urlEncoding;

    setUrlEncoding(newValue);

    dispatch(updateRequestSettings({
      collectionUid: collection.uid,
      itemUid: item.uid,
      settings: { encodeUrl: newValue }
    }));
  }, [urlEncoding, dispatch, collection.uid, item.uid]);

  return (
    <div className="h-full flex flex-col gap-2">
      <div className='flex flex-col gap-4'>
        <ToggleSelector
          checked={urlEncoding}
          onChange={onToggleUrlEncoding}
          label="URL Encoding"
          description="Automatically encode query parameters in the URL"
          size="medium"
        />
      </div>
    </div>
  );
};

export default Settings;