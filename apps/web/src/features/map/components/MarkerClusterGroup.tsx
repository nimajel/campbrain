import { createPathComponent, type LeafletContextInterface } from "@react-leaflet/core";
import L from "leaflet";
import "leaflet.markercluster";
import type { ReactNode } from "react";
import { buildClusterHtml, CLUSTER_SIZE } from "../lib/map-pins";

interface Props {
  children: ReactNode;
}

function createCluster(_props: Props, context: LeafletContextInterface) {
  const instance = L.markerClusterGroup({
    maxClusterRadius: 45,
    disableClusteringAtZoom: 9,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: false,
    zoomToBoundsOnClick: true,
    iconCreateFunction: (cluster) => {
      const matching = cluster.getAllChildMarkers().filter((m) => {
        const icon = m.options.icon;
        return icon instanceof L.DivIcon && String(icon.options.html ?? "").includes("cb-pin--match");
      }).length;
      return L.divIcon({
        html: buildClusterHtml(cluster.getChildCount(), matching),
        className: "",
        iconSize: [CLUSTER_SIZE, CLUSTER_SIZE],
        iconAnchor: [CLUSTER_SIZE / 2, CLUSTER_SIZE / 2],
      });
    },
  });
  return { instance, context: { ...context, layerContainer: instance } };
}

const MarkerClusterGroup = createPathComponent<L.MarkerClusterGroup, Props>(createCluster);

export default MarkerClusterGroup;
