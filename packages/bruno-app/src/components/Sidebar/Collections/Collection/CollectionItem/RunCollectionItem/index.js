import React from 'react';
import get from 'lodash/get';
import { uuid } from 'utils/common';
import Modal from 'components/Modal';
import { useDispatch, useSelector } from 'react-redux';
import { addTab } from 'providers/ReduxStore/slices/tabs';
import { runCollectionFolder } from 'providers/ReduxStore/slices/collections/actions';
import { flattenItems } from 'utils/collections';
import StyledWrapper from './StyledWrapper';
import { areItemsLoading } from 'utils/collections';
import RunnerTags from 'components/RunnerResults/RunnerTags/index';

const RunCollectionItem = ({ collectionUid, item, onClose }) => {
  const dispatch = useDispatch();

  const collection = useSelector(state => state.collections.collections?.find(c => c.uid === collectionUid));
  const isCollectionRunInProgress = collection?.runnerResult?.info?.status && (collection?.runnerResult?.info?.status !== 'ended');

  // tags for the collection run
  const tags = get(collection, 'runnerTags', { include: [], exclude: [] });

  // have tags been enabled for the collection run
  const tagsEnabled = get(collection, 'runnerTagsEnabled', false);

  const onSubmit = (recursive) => {
    dispatch(
      addTab({
        uid: uuid(),
        collectionUid: collection.uid,
        type: 'collection-runner'
      })
    );
    if (!isCollectionRunInProgress) {
      dispatch(runCollectionFolder(collection.uid, item ? item.uid : null, recursive, 0, tagsEnabled && tags));
    }
    onClose();
  };

  const handleViewRunner = (e) => {
    e.preventDefault();
    dispatch(
      addTab({
        uid: uuid(),
        collectionUid: collection.uid,
        type: 'collection-runner'
      })
    );
    onClose();
  }

  const getRequestsCount = (items) => {
    const requestTypes = ['http-request', 'graphql-request']
    return items.filter(req => requestTypes.includes(req.type)).length;
  }

  const runLength = item ? getRequestsCount(item.items) : get(collection, 'items.length', 0);
  const flattenedItems = flattenItems(item ? item.items : collection.items);
  const recursiveRunLength = getRequestsCount(flattenedItems);

  const isFolderLoading = areItemsLoading(item);

  return (
    <StyledWrapper>
      <Modal size="md" title="Collection Runner" hideFooter={true} handleCancel={onClose}>
        {!runLength && !recursiveRunLength ? (
          <div className="mb-8">No request found in this folder.</div>
        ) : (
          <div>
            <div className="mb-1">
              <span className="font-medium">Run</span>
              <span className="ml-1 text-xs">({runLength} requests)</span>
            </div>
            <div className="mb-8">This will only run the requests in this folder.</div>
            <div className="mb-1">
              <span className="font-medium">Recursive Run</span>
              <span className="ml-1 text-xs">({recursiveRunLength} requests)</span>
            </div>
            <div className={isFolderLoading ? "mb-2" : "mb-8"}>This will run all the requests in this folder and all its subfolders.</div>
            {isFolderLoading ? <div className='mb-8 warning'>Requests in this folder are still loading.</div> : null}
            {isCollectionRunInProgress ? <div className='mb-6 warning'>A Collection Run is already in progress.</div> : null}

            {/* Tags for the collection run */}
            <RunnerTags collectionUid={collection.uid} />

            <div className="flex justify-end bruno-modal-footer">
              <span className="mr-3">
                <button type="button" onClick={onClose} className="btn btn-md btn-close">
                  Cancel
                </button>
              </span>
              {
                isCollectionRunInProgress ? 
                  <span>
                    <button type="submit" className="submit btn btn-md btn-secondary mr-3" onClick={handleViewRunner}>
                      View Run
                    </button>
                  </span>
                :
                  <>
                    <span>
                      <button type="submit" disabled={!recursiveRunLength} className="submit btn btn-md btn-secondary mr-3" onClick={() => onSubmit(true)}>
                        Recursive Run
                      </button>
                    </span>
                    <span>
                      <button type="submit" disabled={!runLength} className="submit btn btn-md btn-secondary" onClick={() => onSubmit(false)}>
                        Run
                      </button>
                    </span>
                  </>
              }
            </div>
          </div>
        )}
      </Modal>
    </StyledWrapper>
  );
};

export default RunCollectionItem;
